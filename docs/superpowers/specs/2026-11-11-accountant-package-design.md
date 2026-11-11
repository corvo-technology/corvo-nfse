# Pacote do mês para o contador

Data: 2026-11-11. Status: aguardando aprovação.

## Intenção

Todo fim de mês o contador pede as notas emitidas. Hoje o cliente do Corvo baixa o XML e o PDF **nota por nota** (`GET /v1/invoices/:id/xml` e `/pdf`) e monta a pasta na mão. Quem emite 40 notas por mês perde meia hora nisso, e é uma das primeiras coisas que o cliente reclama de qualquer emissor.

A ideia: um botão "Baixar pacote do mês" que entrega um ZIP pronto, com todas as notas e uma planilha de resumo.

## O que verificamos (e o que não)

- **XML e PDF já existem por nota.** O controller serve `xml` e `pdf` por id, com permissão `nfse.invoices.view`. A nota tem um campo `documentsReadyAt` que indica quando os documentos ficaram prontos; notas autorizadas sem esse marcador ainda não têm documentos.
- **A API não tem listagem por mês nem exportação.** A lista de notas existe (`GET /v1/invoices`), mas não achei nada que gere ZIP ou CSV de notas emitidas. O ZIP existe só na leitura de planilhas de importação.
- **Dependência de ZIP:** o projeto já tem `exceljs`, que traz bibliotecas de ZIP por baixo. O construtor decide entre usar essas ou adicionar uma biblioteca pequena de ZIP em fluxo.
- **O PDF e o XML ficam guardados** (`documentStorage.getPdf`), não são gerados a cada pedido. Por isso o ZIP em fluxo, numa resposta só, é viável: o custo é ler arquivos e compactar.
- **`competenceDate` é uma data** (coluna `date`, sem hora), então filtrar por mês não tem problema de fuso.
- **A nota substituta repete a competência da original** (a regra E0061 proíbe mudá-la). As duas caem no mesmo mês.
- **Não existe trava entre instâncias** (sem Redis nem trava no banco), só o limite de taxa HTTP que já há por chave e por tenant.
- **Não verificado:**
  - Tempo real de ler e compactar 500 notas (medir antes de fixar o limite).
  - Se notas antigas têm todas XML e PDF guardados.

## Metas

- Um pedido devolve um ZIP com, para o mês escolhido de uma empresa:
  - o **XML** e o **PDF** de cada nota;
  - um **`resumo.csv`** com uma linha por nota.
- Disponível na API, no painel (botão na lista de notas) e no MCP.
- Funciona para qualquer empresa do cliente, no ambiente (`test` ou `live`) em que ele estiver.

## Conteúdo do ZIP

```
nfse-2026-11-<cnpj>.zip
├── xml/
│   ├── 000123.xml
│   └── ...
├── pdf/
│   ├── 000123.pdf
│   └── ...
└── resumo.csv      (último arquivo do ZIP)
```

Os arquivos levam o número da nota (6 dígitos, com zeros à esquerda, para ordenar). Nota cancelada leva o prefixo `cancelada-` no nome do arquivo, para o contador ver na pasta.

### `resumo.csv`

Para abrir direto no Excel em português: separador `;`, vírgula decimal, UTF-8 com BOM. Colunas:

número, data de emissão, competência, status, documento do tomador, nome do tomador, código do serviço, descrição, valor bruto, desconto, ISS, valor líquido, chave de acesso.

Todas as notas do mês entram no resumo, inclusive as canceladas (com o status). Notas que ainda não têm documentos prontos entram no resumo com a coluna "documentos" marcada como pendente e ficam de fora das pastas `xml/` e `pdf/`.

## Quais notas entram

- Pela **competência** da nota (o mês a que o serviço se refere), minha escolha: é como o contador fecha o mês. O pedido aceita `month=2026-11`.
- Entram as notas **autorizadas e canceladas**. Não entram as rejeitadas, as que falharam nem as que ainda estão na fila: nenhuma delas tem nota fiscal válida.
- Empresa e ambiente são os do pedido. Nunca mistura empresas.

## Interface

- **API:** `GET /v1/companies/:companyId/invoice-package?month=YYYY-MM`. Resposta é o ZIP em fluxo (`Content-Type: application/zip`, `Content-Disposition: attachment`). Permissão `nfse.invoices.view`, aceita chave de API. `include=xml,pdf` (os dois por padrão) deixa o cliente pedir só um, para pacotes menores.
- **Painel:** na lista de notas, um botão "Baixar pacote do mês" com o seletor de mês (mês atual como padrão). Se não há notas no mês, o botão avisa em vez de baixar um ZIP vazio.
- **MCP:** uma ferramenta que devolve um link temporário de download, no mesmo molde de `nfse_get_download_url`, já que o agente não recebe arquivo grande direto.

## Limites

- **500 notas por pacote**, minha escolha. Acima disso responde `422` com um código estável (`PACKAGE_TOO_LARGE`) dizendo quantas notas o mês tem. O cliente divide pedindo por período em uma versão futura. MEI e Simples com mais de 500 notas por mês são raros.
- **Limite de taxa próprio na rota** (por exemplo, 10 pacotes por hora por tenant, valor do construtor), usando o mesmo mecanismo de limite de taxa que as outras rotas. Não há "um por vez": o projeto não tem trava entre instâncias e criar uma só para isso não compensa.
- O ZIP é gerado em fluxo, sem montar tudo na memória.
- Se um documento específico não puder ser lido do armazenamento, o pacote sai mesmo assim, o problema vai para o `resumo.csv` ("documento indisponível") e a resposta não quebra no meio.

## Casos de borda (decididos)

- **Síncrono.** A resposta é o ZIP direto, sem job nem link. O construtor mede o tempo de 500 notas; se passar do tempo limite do proxy, baixa o limite de notas em vez de criar um fluxo assíncrono.
- **Notas sem documentos.** O pacote **não gera** o que falta, só lista no resumo como "documentos pendentes". Gerar na hora é trabalho do fluxo normal, que já cuida disso.
- **Mês.** `month=YYYY-MM` significa `competenceDate` dentro do mês, comparando datas puras, sem fuso.
- **Nota substituída.** A original, depois que a substituta é autorizada, aparece como cancelada e leva o prefixo `cancelada-`. A substituta aparece como autorizada. As duas entram no mês da competência (a mesma).
- **Colunas do resumo.** Lista fechada para a primeira versão, com mais uma coluna no fim: "documentos" (`ok`, `pendente` ou `indisponível`), totalizando 14. Os valores vêm do que já está guardado na nota e no seu snapshot fiscal; um valor que não existir fica em branco. ISS retido entra depois, quando um contador pedir.
- **Falha depois de começar a enviar.** Se a conexão cair ou o banco falhar no meio, o ZIP chega truncado e o navegador acusa download incompleto. Para o cliente perceber, o `resumo.csv` é o **último** arquivo do ZIP, com a contagem esperada: ZIP sem resumo quer dizer ZIP incompleto. Na prática a leitura é do banco e do armazenamento, e o risco é baixo.
- **Acima de 500 notas.** O painel só mostra o erro com a contagem. Filtro por período fica para depois.

## Envio por e-mail ao contador

O cliente escolhe se quer que o pacote vá para o contador. Se quiser, informa o e-mail dele, e o Corvo manda todo mês sozinho.

- **Como o cliente liga:** na empresa, uma opção "Enviar o pacote do mês ao meu contador" e, quando ligada, o campo "E-mail do contador". Desligada = nenhum envio. No banco é um único campo `accountant_email` na empresa (nulo = desligado), sem flag separada.
- **Quando envia:** no dia 1 de cada mês, de manhã (fuso de São Paulo), com o pacote do **mês anterior**. Há também um botão "Enviar agora ao contador" para o mês escolhido, para quem quiser antes ou depois do dia 1.
- **O que vai no e-mail:** um **link de download** do ZIP, não o arquivo anexado. Um pacote de centenas de PDFs passa do limite de anexo da maioria dos provedores. O link é temporário (7 dias, minha escolha), não exige login e serve só para aquele pacote, no mesmo molde do `POST /v1/invoices/:id/download-url`. O texto diz quem enviou (nome e CNPJ da empresa), o mês, quantas notas e o valor total.
- **Quando NÃO envia:** mês sem notas (sem e-mail vazio, para não virar ruído), ambiente `test` e empresa sem e-mail informado.
- **Sem repetir:** a empresa guarda o último mês enviado (`accountant_package_last_sent_month`); o mesmo mês nunca sai duas vezes, mesmo se a tarefa rodar de novo. O botão "Enviar agora" é a exceção, pois é um pedido explícito.
- **Falha:** erro ao enviar tenta de novo nas próximas horas, usando a estrutura de e-mail transacional que o projeto já tem (e-mails montados em código, sem modelo no provedor). O cliente recebe um aviso se não conseguir enviar.
- **Validação:** e-mail em formato válido; um e-mail só por empresa nesta versão.
- **Privacidade:** o pacote tem dados dos clientes do cliente. Quem o envia é o próprio dono da conta, para o contador que ele indicou. Por isso o link expira, não lista outros pacotes e o painel mostra para qual e-mail o envio está ligado.

## Fora do escopo

- Notas **recebidas** no pacote. Quando a sincronização do portal (spec `2026-11-11-portal-sync-design.md`, Parte B) estiver pronta, o pacote ganha uma pasta `recebidas/`.
- Relatório fiscal, apuração, guia de imposto.
- Formatos além de ZIP e CSV.

## Anti-metas

- O pacote **nunca** inclui nota de outra empresa ou de outro cliente.
- Nunca entrega ZIP incompleto sem avisar: o que ficou de fora aparece no `resumo.csv` ou na resposta de erro.
- Nunca gasta crédito: baixar documentos de notas já emitidas não consome crédito de emissão.

## Pendente antes de implementar

- Medir o tempo de gerar PDF de 100 e de 500 notas, para confirmar o limite de 500 ou trocar por um número realista.
- Conferir um mês real com notas canceladas e substituídas, para o nome dos arquivos e as linhas do resumo fazerem sentido para um contador.
- Mostrar o `resumo.csv` a um contador e perguntar o que falta (por exemplo, ISS retido pelo tomador, que não está nas colunas acima).
