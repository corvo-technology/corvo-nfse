# Importar notas por planilha (CSV ou Excel)

Data: 2026-11-07. Status: aguardando aprovação. Escopo deste documento: **Parte A (API)**. A tela (B) e o cartão de economia (C) vêm depois, em PRs separados. MCP e API pública para importação ficam para depois da tela.

## Intenção

Quem emite muitas notas hoje digita ou chama a API uma por uma. A pessoa deve poder **enviar uma planilha, conferir se quiser e clicar em Emitir**, e ver as notas saindo ao vivo. O argumento de venda é tempo: o que levava ~15 minutos por nota leva segundos.

Critério de sucesso do dono do produto: **simplicidade e fluidez**. A revisão é opcional.

## Metas

- Enviar `.csv` ou `.xlsx` (até **2.000 linhas** e **10 MB**) e receber logo um id de importação.
- Leitura e normalização **assíncronas** (fila), linha a linha, sem derrubar as outras linhas.
- A empresa que emite vem da **coluna do CNPJ do prestador** ou, se não houver, da **empresa escolhida no envio**. Sem nenhum dos dois, a linha é rejeitada com erro claro.
- Revisar: listar as linhas com dados normalizados e erros, e **corrigir e revalidar** uma linha.
- Emitir: enfileirar a emissão das linhas válidas reaproveitando o lote atual (`InvoiceBatchService.emitBatch`).
- Acompanhar: um endpoint de status com contadores (total, válidas, com erro, emitidas, rejeitadas, pendentes) e tempos, para a tela mostrar o progresso ao vivo por polling.
- Baixar um **modelo** de planilha e um **CSV de erros**.
- Respeitar o ambiente (`test`/`live`) da sessão: a importação pertence ao ambiente em que foi criada.

## Fora do escopo (agora)

- Tela, cartão de economia (partes B e C).
- Chave de API e MCP para importar.
- Agendar ou recorrência dentro da planilha (`SCHEDULE`/`RECURRING` não entram, como no lote atual).
- Editar o arquivo original, importar mais de 2.000 linhas, outros formatos (ODS, PDF).
- Mapeador visual de colunas: usamos nomes de coluna conhecidos (português e inglês).

## Anti-metas

- Uma linha ruim **nunca** impede as outras.
- Reenviar a mesma planilha ou clicar em Emitir duas vezes **nunca** emite duas vezes.
- Fórmulas e macros do Excel nunca são executadas; o arquivo é apagado do S3 depois de lido (ficam só as linhas).
- Não prometer tempo exato ao usuário: o tempo mostrado é o medido.

## Fluxo

1. `POST /imports` (multipart: `file`, opcional `companyId`). Valida tipo e tamanho, cria a importação (`status: processing`) e enfileira a leitura. Responde 202 com o id.
2. **Leitura (fila `import`)**: abre o arquivo, lê a primeira planilha, mapeia colunas, normaliza cada linha e valida com as mesmas regras do lote (`BatchInvoiceItemDto`, `prepareEmission` sem gravar). Cada linha vira um registro `import_rows` com `status` `valid` ou `invalid` e o erro em código do catálogo. Ao terminar: `status: ready`. Mais de 2.000 linhas: a importação inteira falha com `ERROR_IMPORT_TOO_MANY_ROWS`, antes de ler as linhas.
3. `GET /imports/:id` (status e contadores), `GET /imports/:id/rows?status=&cursor=` (paginado, como as outras listas).
4. `PATCH /imports/:id/rows/:rowId` corrige campos de uma linha e revalida (só enquanto `ready`).
5. `POST /imports/:id/emit` muda para `emitting` (somente de `ready`, uma vez; repetir devolve o estado atual) e enfileira pedaços de até 50 linhas válidas para `emitBatch`. A chave de idempotência de cada linha é `import:<id>:<número da linha>`. Cada linha termina em `accepted` (invoice id) ou `rejected` (erro). Quando todas terminam: `status: done`.
6. `GET /imports/:id/errors.csv` e `GET /imports/template` (modelo CSV/Excel).
7. `DELETE /imports/:id` descarta uma importação ainda não emitida.

## Estado da importação

`processing` → `ready` → `emitting` → `done`, ou `failed` (arquivo ilegível, grande demais, sem linhas). Contadores calculados das linhas, sem coluna duplicada.

## Colunas do modelo (mínimo)

Nomes aceitos em português ou inglês, sem diferenciar maiúsculas e acentos. CNPJ/CPF aceitos com ou sem máscara.

- `cnpj_prestador` (opcional se a empresa foi escolhida no envio)
- `tomador_documento`, `tomador_nome`, `tomador_email` (opcional)
- `descricao`, `valor`
- `codigo_servico` (opcional, usa o padrão da empresa quando houver)
- `data_competencia` (opcional, padrão hoje)

Normalização: só dígitos em documentos; valor `1.234,56` e `1234.56` viram centavos exatos; datas `dd/mm/aaaa` ou `aaaa-mm-dd`; espaços aparados; células vazias viram ausentes. Colunas desconhecidas são ignoradas, com aviso na importação.

## Estado e persistência

Duas tabelas novas: `imports` (id, tenant, ambiente, usuário, nome do arquivo, hash do arquivo, status, empresa escolhida, tempos de início e fim da emissão) e `import_rows` (importação, número da linha, dados normalizados em JSON, status, erro, invoice id). O arquivo só existe no S3 até ser lido. Migração nova em `api/src/infra/database/migrations`. Linhas e importações antigas expiram (limpeza em 30 dias).

## Permissões e limites

- Exige `nfse.invoices.issue`, mesmas guardas de ambiente do `POST /invoices`.
- Créditos: como no lote, em `live` cada linha aceita reserva um crédito. Linhas além do limite do plano ficam `rejected` com o código de limite, e podem ser emitidas de novo depois de recarregar (novo `POST /imports/:id/emit` envia só as pendentes e rejeitadas por limite).
- Limites de upload: 10 MB e 2.000 linhas; rate limit no upload (como o lote: poucas por minuto).
- Isolamento por tenant e ambiente em todas as consultas.

## Decisões que são minhas (marcadas para revisão)

1. Biblioteca: `exceljs` (xlsx) e `csv-parse` (csv) no API, lendo apenas valores, sem avaliar fórmulas.
2. Primeira planilha do arquivo; cabeçalho na primeira linha não vazia.
3. A empresa escolhida no envio **não** sobrescreve um CNPJ presente na linha: se os dois existirem e diferirem, a linha é rejeitada, para nunca emitir pela empresa errada.
4. Polling (sem SSE/WebSocket) para o acompanhamento ao vivo na tela.
5. Pedaços de 50 linhas, no máximo um pedaço por vez por importação, para respeitar o limite do lote e manter a ordem.
6. Tabelas próprias em vez de reaproveitar o lote, porque revisão e reenvio exigem guardar linhas.
7. Modelo da planilha e colunas: proposta minha, a confirmar.

## Decisões da revisão (minhas, para conferir)

8. **Segunda emissão.** `done` significa que todas as linhas têm destino final, exceto as rejeitadas por limite de créditos, que continuam reenviáveis. Um novo `POST /imports/:id/emit` volta de `done` para `emitting` e envia só essas linhas. Linhas rejeitadas não são salvas pelo lote, então a mesma chave de idempotência volta a funcionar: não é preciso sufixo.
9. **Campos que faltam.** Endereço do tomador, código do serviço e dados fiscais vêm dos padrões da empresa (perfil de serviço) quando existirem. Se faltar algo obrigatório, a linha é rejeitada pela validação do lote, com o erro do catálogo. Nada é inventado.
10. **CNPJ do prestador.** Resolvido por `companyTaxId` dentro do tenant e do ambiente da importação, como o lote já faz. Se o mesmo CNPJ existir em teste e produção, vale o ambiente da importação.
11. **Quem emite.** A importação guarda o usuário e o ambiente de quem clicou em Emitir. O trabalhador reconstrói o contexto de autenticação a partir disso e confere a permissão `nfse.invoices.issue` de novo a cada pedaço; se ela sumiu, as linhas restantes ficam pendentes com erro de permissão.
12. **Créditos.** A reserva acontece por linha ao salvar o lote, então um pedaço pode ser aceito só em parte: as primeiras linhas em ordem entram, as demais saem rejeitadas por limite.
13. **Arquivo entre o envio e a fila.** Os bytes vão para o S3 (mesmo bucket e credenciais do armazenamento de PDF/XML), numa chave `imports/<tenant>/<ambiente>/<importId>`, sem usar o nome original. Um armazenamento pequeno e próprio (salvar, ler, apagar) é criado, porque o atual só conhece PDF e XML de nota. O arquivo é apagado assim que a leitura termina (com sucesso ou falha) e quando a importação é descartada; uma limpeza diária remove arquivos órfãos com mais de 24 horas. O arquivo nunca é entregue por link. O 202 sai rápido, sem ler o arquivo no pedido.
14. **Validação sem gravar.** `prepareEmission` só consulta (chave de idempotência, empresa); se ele criar algum efeito colateral, separamos uma validação pura em `InvoiceService`.

## Fica para quem constrói

- Nomes exatos de classes, rotas dentro dos módulos e formato dos DTOs, seguindo o padrão do módulo `invoice-schedule`.
- Como detectar a codificação do CSV (UTF-8 com ou sem BOM; Latin-1 comum no Excel brasileiro) e o separador (`;` ou `,`).
- Estratégia de fila e retomada se o processo reiniciar no meio da emissão (a idempotência por linha garante segurança).
