# Clientes salvos, informações complementares e convênio do município

Data: 2026-11-10. Status: aguardando aprovação. Três partes independentes, cada uma em PR próprio, nesta ordem: **A** (clientes), **B** (informações complementares), **C** (convênio). A tela do painel da parte A vem em PR separado.

## Origem

Comparamos o que o sistema nacional da NFS-e oferece (guia do Emissor Nacional v1.3, manuais das APIs, anexos do leiaute v1.01 e perguntas e respostas de 08/09/2026) com o que o Corvo faz hoje e com o que a biblioteca `open-nfse` já entrega. Estas três partes são as que dão mais valor com menos complexidade. Tomador no exterior e exportação ficam para uma spec própria.

## O que verificamos (e o que não)

- **O governo não preenche o nome do tomador pela API.** No XSD v1.01, `TCInfoPessoa/xNome` é obrigatório sempre que há tomador. Só `IM`, `CAEPF` e `end` são opcionais. O Sefin apenas confere se o CPF ou CNPJ existe na data de competência (regras E0190 e E0207). O preenchimento automático que o portal mostra acontece dentro do Emissor Nacional, e não confirmamos nenhuma API pública para isso.
- **O Corvo hoje** valida o dígito do CPF/CNPJ do cliente, mas **não exige nem preenche o nome**. O `tomador` do DPS vai só com documento e nome, sem endereço. Não há cadastro de clientes: cada nota guarda um `customer_snapshot`.
- **Não verificado:** o que acontece hoje com uma nota que traz CPF/CNPJ sem nome. Pelo XSD ela deveria falhar, mas não rodamos o caso. Isso vira um teste na Parte A.
- A `open-nfse` já expõe `consultarConvenio`, `consultarRetencoes`, `consultarAliquota`, `consultarBeneficio` e `substituir`. O Corvo não usa nenhuma delas.

---

## Parte A. Clientes salvos e preenchimento do nome

### Intenção

Quem emite para o mesmo cliente várias vezes não deve digitar o nome toda vez. Na primeira nota o nome é informado. Nas seguintes, basta o CPF ou CNPJ.

### Metas

- Guardar, por empresa titular da conta (tenant) e ambiente, os clientes das notas aceitas.
- Quando a nota traz `customer.taxId` e não traz `customer.name`, preencher nome, e-mail e endereço a partir do cadastro.
- API para listar, consultar, corrigir e apagar clientes salvos.
- O mesmo preenchimento vale para **lote, planilha e agenda**, porque todos passam pela normalização do `InvoiceDomainService`.

### Fora do escopo (agora)

- Consulta de CNPJ em serviço externo. Fica atrás de uma porta (`ICustomerDirectory`) para a gente plugar depois, quando houver decisão sobre fornecedor, contrato e limites. CPF nunca terá consulta externa de nome.
- Tela do painel (autocomplete e lista): PR seguinte.
- Tomador no exterior.
- Ferramenta no MCP.

### Anti-metas

- Nunca sobrescrever, sem avisar, um dado enviado na própria requisição. O que veio na requisição vale.
- Nunca misturar `test` e `live`, nem tenants. A tabela segue a política de isolamento por tenant das demais.
- Nota já emitida nunca muda por causa de alteração no cadastro. O snapshot da nota continua sendo a fonte do que foi emitido.
- Nunca guardar cliente de nota anônima.

### Modelo de dados

Tabela `customers` (migration com a mesma política de tenant de `invoice_schedules`):

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` | uuid | FK `tenants`, `ON DELETE CASCADE` |
| `environment` | varchar(10) | `test` ou `live` |
| `tax_id` | varchar(14) | só dígitos, CPF (11) ou CNPJ (14) |
| `name` | varchar(150) | obrigatório |
| `email` | varchar(255) | opcional |
| `municipality_code`, `city`, `state` | varchar | opcionais, como no `customer_snapshot` |
| `last_used_at`, `created_at`, `updated_at` | timestamptz | |

Índice único `(tenant_id, environment, tax_id)`. O tamanho de `name` deve seguir o limite do XSD para `xNome` (`TSNomeRazaoSocial`); **confirmar o valor exato no schema antes da migration.**

### Fluxo

1. **Normalização** (`InvoiceDomainService.normalizeAndValidate`): se há `customer.taxId` válido e `customer.name` vazio, busca em `customers` e preenche nome, e-mail e endereço que estiverem vazios.
2. Sem cadastro e sem nome: **422** com `customer.name` obrigatório e mensagem dizendo que é a primeira nota para esse documento. Isso troca uma falha tardia na montagem do DPS por um erro claro na entrada. **Decisão pendente abaixo.**
3. **Depois de criar a nota** (resposta 202): `upsert` por `(tenant, environment, tax_id)`. O nome enviado na requisição atualiza o cadastro. `last_used_at` é atualizado.
4. O `Idempotency-Key` continua usando o hash calculado **antes** da normalização, como hoje. O preenchimento não altera o hash, e a repetição devolve a mesma nota.
5. Agenda: o preenchimento roda a cada execução (a agenda guarda o `invoice_input` e normaliza de novo), então uma correção de nome vale para as próximas notas.

### API

- `GET /v1/customers?search=&limit=&cursor=`: busca por nome ou documento, paginação por cursor como nas outras listas.
- `GET /v1/customers/:taxId`
- `PATCH /v1/customers/:taxId`: corrige nome, e-mail, endereço.
- `DELETE /v1/customers/:taxId`: apaga o cadastro (não apaga notas).
- Permissões: reutilizar `nfse.invoices.view` para ler e `nfse.invoices.issue` para alterar e apagar. **Confirmar se queremos permissões próprias.**

### LGPD

Nome e CPF já ficam guardados no `customer_snapshot` de cada nota, mas um cadastro reutilizável é um tratamento novo. Antes do merge: revisar a finalidade e o prazo de retenção no aviso de privacidade e no DPA, e garantir que o `DELETE` e a exclusão da empresa (tenant) apaguem o cadastro.

### Testes

- Unitário: preenchimento só do que falta; o que veio na requisição vence; sem cadastro e sem nome dá 422; nota anônima não grava cliente.
- Integração com Postgres: isolamento entre tenants e entre `test` e `live`; índice único; `upsert` concorrente.
- XML: DPS montado com cliente preenchido passa em `validateDpsXml` (XSD v1.01).
- Caso novo que registra o comportamento atual de CPF/CNPJ sem nome.

---

## Parte B. Informações complementares na nota

### Intenção

Empresas clientes costumam exigir o número do pedido ou da ordem de serviço na nota. Hoje o Corvo não permite.

### Metas

Dois campos opcionais, nas mesmas entradas que já aceitam `deduction`: `POST /v1/invoices`, lote, planilha, agenda e a ferramenta `nfse_issue` do MCP.

| Campo da API | Campo da DPS | Limite (XSD v1.01) |
|---|---|---|
| `purchaseOrder` | `serv/infoCompl/xPed` | 1 a 60 caracteres. Descrição oficial: pedido, ordem de compra, ordem de serviço ou projeto que autoriza a prestação, em operações B2B |
| `notes` | `serv/infoCompl/xInfComp` | 1 a 2.000 caracteres, não pode ser só espaços |

`docRef` (até 255) e os itens de pedido (`gItemPed`) ficam para depois.

### Fora do escopo

Dedução, desconto condicionado, ART/RRT (`idDocTec`) e qualquer campo que mude tributo. Estes dois campos **não alteram imposto**.

### Fluxo

1. DTO e normalização validam tamanho e rejeitam valor só com espaços.
2. Os valores vão dentro do `service_snapshot` (já é `jsonb`, **sem migration**), para que uma nova tentativa reconstrua o mesmo DPS.
3. O `DpsBuilder` (`api/src/modules/invoice/domain/fiscal/dps/dps-builder.ts`) preenche `serv.infoCompl`. A suíte `anexo1-conformance.spec.ts` já cobre regras do Anexo I e ganha os casos novos.
4. Caminho legado (sem snapshot fiscal): não consegue carregar esses campos. Segue o padrão que já existe para a dedução: rejeitar com erro explícito em vez de emitir sem o campo.
5. Verificar se o DANFSe local (`danfse-view.ts`) já imprime as informações complementares, conforme a NT 008. Se não imprimir, é ajuste pequeno no mesmo PR.

### Anti-metas

- Sem HTML nem caracteres de controle no texto.
- O Corvo nunca injeta dado de cliente ou de pagamento nesses campos por conta própria.
- Campo vazio não vai ao XML (o XSD proíbe valor vazio).

### Testes

DTO (limites e só espaços); DPS com os campos passa no XSD; DPS sem os campos continua byte a byte igual ao de hoje; caminho legado rejeita com erro claro.

---

## Parte C. Convênio do município

### Intenção

Hoje a cobertura de município vem de uma lista estática gerada de uma planilha da Receita, que envelhece. A `open-nfse` consulta o convênio do município direto no Sefin. O usuário deve saber, ao cadastrar a empresa, se o município dele serve para emitir pelo padrão nacional.

### Metas

- Consultar `consultarConvenio(codMunicipio)` e guardar o resultado na empresa, com a data da consulta.
- Mostrar um **aviso** na prontidão da empresa quando o município não estiver pleno ou ativo.
- Manter a lista estática como alternativa quando a consulta não estiver disponível.

### Fora do escopo

- Alíquota, retenções e benefícios municipais (`consultarAliquota`, `consultarRetencoes`, `consultarBeneficio`). Para MEI e Simples Nacional o ISS vai no DAS, e a consulta só importa quando o tomador retém ISS. Fica para uma spec própria.
- Bloquear a emissão com base na consulta.

### Anti-metas

- **Nunca bloquear** a emissão por causa do convênio. O parâmetro pode estar defasado, e quem decide é o Sefin.
- Falha da consulta (rede, certificado) nunca impede cadastrar ou usar a empresa.

### Fluxo

1. A consulta usa o certificado ativo da empresa. **Sem certificado, não consulta** e mostra "ainda não verificado". Assim o ambiente de teste sem certificado continua funcionando.
2. Dispara no envio do certificado e na leitura de prontidão da empresa quando o resultado tiver mais de 24 horas.
3. O cache da biblioteca é em memória por processo; com várias instâncias, o resultado é guardado na própria empresa (coluna `jsonb` e `checked_at`) para não consultar o Sefin a cada requisição.
4. O aviso entra no mesmo lugar onde a prontidão da empresa já é calculada.

### Pendente antes de implementar

- **Significado dos campos:** `tipoConvenio` (1 pleno, 2 simplificado), `aderenteAmbienteNacional` (`0`, `1` ou `-1`) e `situacaoEmissaoPadraoContribuintesRFB`. Mapear contra os manuais e contra respostas reais em homologação, para o aviso dizer a coisa certa. A pesquisa nos manuais apontou que o município pode estar só "Ativo na Plataforma" (compartilhando notas de um sistema próprio), caso em que contribuintes emitem pelo sistema local, exceto MEI.
- **Autenticação da consulta:** não confirmamos se a API de parâmetros aceita qualquer certificado ICP-Brasil válido ou só o do contribuinte. Se aceitar qualquer um, dá para consultar sem certificado da empresa.

---

## Decisões para o dono do produto

1. **Sem cadastro e sem nome, falhar com 422 já na entrada?** Muda o contrato se hoje a nota passa. Verificar o comportamento atual primeiro (teste da Parte A). Recomendação: sim.
2. **Cadastro de clientes por tenant** (proposto) **ou por empresa?** Por tenant evita redigitar quando a mesma conta tem várias empresas.
3. **Consulta externa de CNPJ:** vale fazer depois? Exige escolher fornecedor e rever o aviso de privacidade.
4. **Permissões próprias** para clientes ou reutilizar as de notas?
5. **Convênio sem certificado:** aceitar o "não verificado" ou investir em um certificado da própria plataforma para consultar?

## Ordem dos PRs

1. A1: migration, normalização, `upsert`, API e testes.
2. A2: painel (autocomplete na nota e lista de clientes).
3. B: campos complementares na API, planilha, agenda e MCP.
4. C: convênio e aviso de prontidão.
