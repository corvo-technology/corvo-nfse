> Novo contrato HTTP: consulte [sucesso, erros, cursor e rate limit](docs/api/http-contract.md) e a [matriz de rotas](docs/api/route-contract-matrix.md). Exemplos antigos de respostas e paginação neste documento devem ser migrados.

# API para o frontend Corvo

Inventário dos controllers registrados na API. No ambiente local atual, a base é
`http://localhost:3000/v1`. O prefixo `v1` é global: não repetir nas rotas.
As origens permitidas no `.env` são `http://localhost:4000` e
`http://localhost:5173`. Ajustar `CORS_ORIGINS` ao usar outra origem.

## Autenticação e requisições

O dashboard usa cookie de sessão, sem senha e sem JWT no localStorage.
Usar `credentials: 'include'` em todas as chamadas. Nas mutações autenticadas
(`POST`, `PATCH`, `DELETE`), enviar `x-csrf-token` com o valor recebido no login
ou em `GET /auth/session`. Usar JSON; para certificado, usar `FormData` e deixar
o navegador definir o Content-Type. O Origin deve estar permitido no backend.

Cookie: `gf_session_dev` em development/test; `__Host-gf_session` em produção,
HttpOnly, Path=/, SameSite=Lax, Secure em produção. O frontend não precisa
ler nem armazenar o token de sessão. Produção exige HTTPS; frontend e API
devem estar no mesmo site para os cookies SameSite=Lax funcionarem.

`S` na tabela significa sessão com tenant ativo. `S/K` também aceita `x-api-key`
com escopo suficiente. API keys são para integrações; o dashboard usa sessão.
Rotas públicas dispensam sessão. OAuth está registrado, mas permanece pendente
para uso como login público; ver pendências abaixo.

## Ambientes test e live

Os valores públicos são somente `test` e `live`. No seletor do dashboard,
mostrar **Teste** e **Produção**, enviando `test` e `live` respectivamente.

| Autenticação                | Seleção de ambiente fiscal                                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Dashboard, cookie de sessão | Header `X-Corvo-Environment: test` ou `live`; ausência significa `test`                                                 |
| Integração, `x-api-key`     | Exclusivamente o ambiente persistido da chave `corvo_test_...` ou `corvo_live_...`; o header é ignorado, mesmo inválido |

Essa seleção vale para **todas** as rotas de empresas, certificados e notas,
incluindo listagem, criação, alteração, exclusão, eventos, downloads e e-mails.
Não enviar `environment` no body: retorna 400. O ambiente fica gravado na
criação e não pode ser alterado. A criação de API keys continua aceitando
`environment` no seu próprio body, para definir a chave.

O mesmo CNPJ pode ter uma empresa em cada ambiente, com IDs independentes.
Uma nota deve apontar para o ID da empresa do ambiente selecionado. IDs de
outro tenant ou ambiente retornam 404, inclusive nos downloads. Ao trocar o
seletor, limpar a seleção de empresa e recarregar empresas/notas; incluir
tenant e ambiente nas chaves de cache do frontend.

Planos, carteira, chaves e configurações de webhooks são compartilhados e
não mudam com o seletor. As entregas de webhooks mostram ambos os ambientes
por padrão; `?environment=test` ou `live` filtra explicitamente o histórico.
Cada evento fiscal informa seu ambiente real em `environment`.

Em `test`, a emissão é uma simulação offline: dispensa certificado, produz
XML/PDF marcados **SIMULAÇÃO SEM VALIDADE FISCAL**, permite download e envio
por e-mail, e não consome créditos, limite diário ou vagas de empresas live.
O envio de e-mail em test continua passando pelo provedor de e-mail: use um
destinatário seu. O assunto recebe `[TESTE]`. A simulação não valida regras
fiscais municipais nem autoriza uma nota no governo.

Em `live`, exige empresa com inscrição municipal, certificado PKCS#12 válido
e correspondente ao CNPJ, plano ativo, créditos e quota disponível. Reserva
um crédito na submissão; autorização confirma o débito, rejeição devolve o
crédito. Resultado incerto mantém a reserva para reconciliação usando a
mesma DPS assinada. Empresas test não ocupam vagas live.

Exemplo de dashboard, preservando cookie e CSRF do cliente abaixo:

```ts
type FiscalEnvironment = 'test' | 'live';
let fiscalEnvironment: FiscalEnvironment = 'test';
const companies = await api('/companies', {
  headers: { 'X-Corvo-Environment': fiscalEnvironment },
});
const issued = await api('/invoices', {
  method: 'POST',
  headers: {
    'X-Corvo-Environment': fiscalEnvironment,
    'Idempotency-Key': crypto.randomUUID(),
  },
  body: JSON.stringify(payload),
});
```

Guardar a chave de idempotência por operação e reutilizá-la nos retries.
A mesma chave e conteúdo normalizado devolvem a mesma nota; conteúdo
diferente retorna 409. O escopo é tenant + ambiente, portanto test e live
podem usar a mesma chave sem compartilhar a nota.

## Login por código de e-mail

1. `POST /auth/magic-link/request` com `{ "email": "voce@empresa.com" }`.
   Resposta HTTP 200:

```json
{
  "data": {
    "challengeId": "uuid",
    "expiresAt": "data ISO",
    "resendAvailableAt": "data ISO"
  }
}
```

2. Mostrar campo de seis dígitos. Reenvio usa a mesma rota após
   `resendAvailableAt`; guardar o novo `challengeId`.
3. `POST /auth/magic-link/verify` com:

```json
{
  "email": "voce@empresa.com",
  "challengeId": "uuid retornado",
  "code": "123456"
}
```

Resposta HTTP 200, com Set-Cookie:

```json
{ "data": { "expiresAt": "data ISO", "isNewUser": true, "csrfToken": "token" } }
```

O código é validado no Redis, vinculado a e-mail/finalidade/produto, expira e
só pode ser usado uma vez. A solicitação não retorna o código. O worker envia
o e-mail. O primeiro login verificado cria um workspace Free e membership
admin em transação; contas com membership ativo usam o workspace existente.
Memberships inativos não são reativados pelo login.

4. Buscar `GET /auth/session`, carregar contexto/permissões e abrir o dashboard.
   Guardar o CSRF em memória; recuperar pela sessão ao recarregar a página.
5. Sair por `POST /auth/session/logout`, com CSRF, e limpar o estado do frontend.

```ts
const API = 'http://localhost:3000/v1';
let csrfToken: string | undefined;

async function api(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (csrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(init.method ?? 'GET')) {
    headers.set('x-csrf-token', csrfToken);
  }
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });
  if (response.status === 204) return null;
  const body = await response.json();
  if (!response.ok) throw { status: response.status, body };
  return body;
}

const issued = await api('/auth/magic-link/request', {
  method: 'POST',
  body: JSON.stringify({ email }),
});
// Quando o usuário preencher o código recebido:
const verified = await api('/auth/magic-link/verify', {
  method: 'POST',
  body: JSON.stringify({ email, code, challengeId: issued.data.challengeId }),
});
csrfToken = verified.data.csrfToken;
const session = await api('/auth/session');
```

## Todos os endpoints

Os caminhos abaixo são relativos à base `/v1`. `{id}` e similares são valores
no caminho, normalmente UUID. As permissões são verificadas no backend.

| Método | Caminho                                                | Acesso / permissão              | Entrada / uso                                                                      |
| ------ | ------------------------------------------------------ | ------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------- |
| POST   | `/auth/magic-link/request`                             | Público                         | JSON: `email`                                                                      |
| POST   | `/auth/magic-link/verify`                              | Público                         | JSON: `email`, `challengeId`, `code`                                               |
| GET    | `/auth/session`                                        | S                               | Contexto, tenants disponíveis, permissões, expiração e CSRF                        |
| POST   | `/auth/session/logout`                                 | S                               | Sem body; revoga sessão e limpa cookie; 204                                        |
| POST   | `/auth/session/tenant`                                 | S                               | JSON: `tenantId`; troca tenant; 201                                                |
| GET    | `/auth/me`                                             | S                               | Contexto do usuário/tenant                                                         |
| GET    | `/auth/memberships`                                    | S                               | Memberships do tenant ativo                                                        |
| GET    | `/auth/permissions`                                    | S                               | Catálogo de categorias/permissões                                                  |
| POST   | `/auth/invite`                                         | S, `settings.manage`            | JSON: `email`, `name`, `role`; cria membership; 201                                |
| GET    | `/auth/members`                                        | S, `settings.manage`            | Membros: `id` do usuário, e-mail, nome, role, createdAt                            |
| DELETE | `/auth/members/{id}`                                   | S, `settings.manage`            | ID do usuário; desativa membership                                                 |
| POST   | `/auth/logout`                                         | S                               | Legado: apenas retorna `loggedOut`; usar `/auth/session/logout`                    |
| GET    | `/auth/api-keys`                                       | S, `api_keys.manage`            | Lista sem hashes/chaves completas                                                  |
| POST   | `/auth/api-keys`                                       | S, `api_keys.manage`            | JSON: `name`, `environment`, `scope`, `expiresAt?`; chave completa uma vez; 201    |
| DELETE | `/auth/api-keys/{id}`                                  | S, `api_keys.manage`            | Revoga chave                                                                       |
| GET    | `/auth/oauth/google/authorize`                         | Pendente                        | Retorno `{url}`; implementação ainda exige sessão                                  |
| GET    | `/auth/oauth/google/callback`                          | Pendente                        | Query: `code`; callback do provedor                                                |
| GET    | `/auth/oauth/github/authorize`                         | Pendente                        | Retorno `{url}`; implementação ainda exige sessão                                  |
| GET    | `/auth/oauth/github/callback`                          | Pendente                        | Query: `code`; callback do provedor                                                |
| GET    | `/plans`                                               | Público                         | Query: `cycle=monthly\|annual`                                                     |
| GET    | `/plans/quote`                                         | Público                         | Query: `volume`, `cycle?`; recomendação para volume                                |
| GET    | `/plans/{slug}`                                        | Público                         | Query: `cycle?`; detalhes/preço do plano                                           |
| GET    | `/billing/plan`                                        | S/K, `billing.view`             | Plano atual e utilização                                                           |
| GET    | `/billing/usage`                                       | S/K, `billing.view`             | Quotas e utilização                                                                |
| POST   | `/billing/upgrade`                                     | S/K, `billing.manage`           | JSON: `plan_slug`; altera plano; 201; pagamento pendente                           |
| POST   | `/billing/downgrade`                                   | S/K, `billing.manage`           | JSON: `plan_slug`; agenda mudança ao fim do período; 201                           |
| GET    | `/credits`                                             | S/K, `credits.view`             | `{tenantId, balance}`                                                              |
| GET    | `/credits/plans`                                       | S/K, `credits.view`             | Lista de entidades de planos                                                       |
| POST   | `/credits/purchase/preview`                            | S/K, `credits.view`             | JSON: `amountBrlCents`, inteiro >=1000; 201                                        |
| POST   | `/credits/purchase/confirm`                            | S, `credits.manage`             | JSON: `amountBrlCents`, `stripeSessionId?`; 201; pagamento pendente                |
| GET    | `/credits/history`                                     | S/K, `credits.view`             | Query: `offset?`, `limit?`                                                         |
| POST   | `/companies`                                           | S/K, `nfse.companies.manage`    | JSON CreateCompany; 201                                                            |
| GET    | `/companies`                                           | S/K, `nfse.companies.view`      | Query: `cursor?`, `limit?`                                                         |
| GET    | `/companies/{id}`                                      | S/K, `nfse.companies.view`      | Detalhes da empresa                                                                |
| PATCH  | `/companies/{id}`                                      | S/K, `nfse.companies.manage`    | JSON: campos opcionais UpdateCompany                                               |
| DELETE | `/companies/{id}`                                      | S/K, `nfse.companies.manage`    | Soft delete; `{data:null}`                                                         |
| POST   | `/companies/{companyId}/certificates`                  | S/K, `nfse.certificates.manage` | Multipart: `file` PKCS#12, `password` do certificado; até 50 KiB; 201              |
| GET    | `/companies/{companyId}/certificates`                  | S/K, `nfse.certificates.view`   | Lista de metadados de certificados                                                 |
| DELETE | `/companies/{companyId}/certificates/{certId}`         | S/K, `nfse.certificates.manage` | Revoga/exclui; 204                                                                 |
| POST   | `/invoices`                                            | S/K, `nfse.invoices.issue`      | JSON CreateInvoice; header `idempotency-key?`; 202                                 |
| GET    | `/invoices`                                            | S/K, `nfse.invoices.view`       | Query: `companyId?`, `status?`, `from?`, `to?`, `externalId?`, `limit?`, `cursor?` |
| GET    | `/invoices/{id}`                                       | S/K, `nfse.invoices.view`       | Detalhes/status da nota                                                            |
| GET    | `/invoices/{id}/events`                                | S/K, `nfse.invoices.view`       | Histórico de transições                                                            |
| GET    | `/invoices/{id}/xml`                                   | S/K, `nfse.invoices.view`       | Arquivo XML; nota autorizada                                                       |
| GET    | `/invoices/{id}/pdf`                                   | S/K, `nfse.invoices.view`       | Arquivo PDF; nota autorizada                                                       |
| POST   | `/invoices/{id}/download-url`                          | S/K, `nfse.invoices.view`       | Body: `{format: "pdf"                                                              | "xml"}`; URL pré-assinada para download |
| POST   | `/invoices/{id}/email`                                 | S/K, `nfse.invoices.issue`      | Header `Idempotency-Key`; reenvia e-mail da nota; 202                              |
| GET    | `/webhooks`                                            | S/K, `webhooks.view`            | Lista sem segredo                                                                  |
| POST   | `/webhooks`                                            | S/K, `webhooks.manage`          | JSON: `url`, `events`; retorna segredo na criação; 201                             |
| DELETE | `/webhooks/{id}`                                       | S/K, `webhooks.manage`          | Exclui configuração                                                                |
| POST   | `/webhooks/{id}/test`                                  | S/K, `webhooks.manage`          | Envia evento de teste; 201                                                         |
| GET    | `/webhooks/deliveries`                                 | S/K, `webhooks.view`            | Query: `hours?`, `limit?`, `offset?`, `environment=live\|test`; padrão ambos/24h   |
| GET    | `/webhooks/deliveries/stats`                           | S/K, `webhooks.view`            | Query: `hours?`, `environment?`; total/sent/failed/pending/delayed                 |
| POST   | `/webhooks/deliveries/{id}/retry`                      | S/K, `webhooks.manage`          | Reenvio manual; 200                                                                |
| POST   | `/public/security/turnstile/verify`                    | Público                         | JSON: `token` (ou `response` / `cfTurnstileResponse`); 201                         |
| POST   | `/public/security/otp/challenges`                      | Público                         | JSON RequestOtp; retorna desafio; 202                                              |
| POST   | `/public/security/otp/challenges/{challengeId}/verify` | Público                         | JSON VerifyOtp; retorna prova, sem criar sessão; 201                               |
| POST   | `/security/otp/challenges`                             | S                               | JSON RequestOtp; retorna desafio; 202                                              |
| POST   | `/security/otp/challenges/{challengeId}/verify`        | S                               | JSON VerifyOtp; retorna prova; 201                                                 |
| GET    | `/health/live`                                         | Público                         | Liveness                                                                           |
| GET    | `/health/ready`                                        | Público                         | Readiness de banco/Redis                                                           |

## Payloads e enums

**CreateCompany**: obrigatórios `legalName`, `taxId`, `taxRegime`.
Opcionais `tradeName`, `municipalReg`, `municipalityCode`, `simpleNational`,
`specialRegime`, `address`. UpdateCompany aceita os mesmos
campos, todos opcionais. Address: `street`, `number`, `complement`, `district`,
`city`, `state`, `zip`, todos opcionais.

```json
{
  "legalName": "Empresa Exemplo LTDA",
  "taxId": "11222333000181",
  "taxRegime": "MEI",
  "municipalReg": "12345",
  "municipalityCode": "3550308"
}
```

**CreateInvoice**: obrigatórios `customer`, `service`, `amount`,
`competenceDate` e a empresa, informada por `companyId` (uuid) **ou**
`companyTaxId` (CNPJ, com ou sem pontuação); pelo menos um dos dois. Se vierem
os dois, vale o `companyId`. Empresa inexistente no tenant/ambiente retorna 404.
Opcionais `externalId`, `email: {send?: boolean}` e `options: {type?: "IMMEDIATE" | "SCHEDULE"}`.
`IMMEDIATE` é o padrão. Com `SCHEDULE`, envie `competenceDate` futura em
`YYYY-MM-DD`; `data.props.scheduledFor` retorna a data ISO de liberação às
00:00 em `America/Sao_Paulo` (ou `null` para emissão imediata). A nota permanece
`queued` até esse instante. Datas além do horizonte configurado (15 dias por
padrão) retornam HTTP 422 com issue code `schedule_horizon_exceeded`.

O aceite persiste a nota, o evento e a mensagem da outbox na mesma transação.
Depois que a publicação é confirmada, um reset do Redis pode perder o job e
manter a nota em `queued`; o scheduler de recuperação de documentos não
recupera esse caso.
Amount é valor monetário, mínimo 0.01. Customer exige `taxId` e `name`;
aceita `email` e `address: {city?,state?,country?}`. Service exige `code`;
`description` e `municipalityCode` são opcionais. Ver "Validação fiscal e
status da empresa".

```json
{
  "companyId": "uuid da empresa",
  "externalId": "pedido-123",
  "customer": {
    "taxId": "52998224725",
    "name": "Cliente",
    "email": "seu-email@example.com"
  },
  "service": {
    "description": "Consultoria",
    "code": "010101",
    "municipalityCode": "3550308"
  },
  "amount": 150.0,
  "competenceDate": "2026-10-09",
  "email": { "send": true }
}
```

`code` é o código nacional de tributação de seis dígitos. O exemplo serve
ao simulador; em live, usar os códigos e cadastro fiscal reais da empresa.
Enviar CPF/CNPJ sem pontuação e competência como `YYYY-MM-DD`.

**Nota fiscal**: `POST /invoices` retorna 202 com `{data: {props: {...}}}` em estado
`queued`; não significa que a nota já está autorizada. Buscar
`GET /invoices/{id}` até `props.status === 'authorized'` e
`props.documentsReadyAt !== null`, ou acompanhar webhooks. A resposta inclui:

| Campo                    | Tipo                                                      | Descrição                                                                |
| ------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------ |
| `props.environment`      | `test\|live`                                              | Ambiente persistido da nota                                              |
| `props.documentsReadyAt` | `string\|null`                                            | Data ISO; quando preenchida, XML/PDF estão prontos                       |
| `props.lastEmailStatus`  | `queued\|sent\|failed\|null`                              | Estado do último envio                                                   |
| `props.lastEmailSentAt`  | `string\|null`                                            | Data ISO do último envio                                                 |
| `props.documentsStatus`  | `pending\|ready`                                          | Estado dos documentos (derivado de `documentsReadyAt`)                   |
| `props.emailStatus`      | `queued\|sent\|failed\|null`                              | Igual a `lastEmailStatus`; `null` = e-mail ainda não enviado/enfileirado |
| `props.stage`            | `pending\|authorized\|documents_ready\|completed\|failed` | Visão calculada do ciclo (não é armazenada)                              |

`status` é sempre o estado **fiscal** e `authorized` é final; documentos e e-mail
têm campos próprios. `stage`: `pending` (em processamento), `authorized` (sem
documentos), `documents_ready` (documentos prontos, e-mail solicitado ainda não
resolvido), `completed` (documentos prontos e e-mail não solicitado, `sent` ou
`failed`) e `failed` (`rejected`/`failed`).

XML autorizado e hash interno da requisição não aparecem na resposta pública.

**POST /invoices/{id}/download-url** - Gera URL pré-assinada para download de documento.

Requisição:

```json
{ "format": "pdf" }
```

ou

```json
{ "format": "xml" }
```

Resposta HTTP 201:

```json
{
  "data": {
    "downloadUrl": "https://...",
    "expiresAt": "2026-10-09T12:00:00Z",
    "fileName": "nfse-123.pdf",
    "mimeType": "application/pdf"
  }
}
```

Cabeçalhos de resposta: `Cache-Control: no-store`.
A URL expira em uma hora. Abrir `data.downloadUrl` diretamente no navegador:
o arquivo vem do S3, sem passar pela API. Não enviar cookies, API key ou o
header de ambiente ao S3. Gerar uma nova URL quando expirar. As rotas
`/pdf` e `/xml` permanecem disponíveis para integrações que precisam do arquivo.

Erros:

- 404: Nota não encontrada no tenant e ambiente selecionados
- 409: Nota não autorizada ou `props.documentsReadyAt` ainda nulo
- 503: Armazenamento indisponível

**POST /invoices/{id}/email** - Reenvia o e-mail da nota fiscal ao cliente.

Cabeçalho: `Idempotency-Key: <uuid>` para evitar duplicação.

Resposta HTTP 202:

```json
{
  "data": { "emailId": "inv_1234567890_abc", "status": "queued" }
}
```

O worker baixa PDF/XML do S3 e envia como anexos. Na criação, `email.send=true`
agenda esse envio automaticamente após preparar documentos; esta rota solicita
um reenvio manual. Reutilizar `Idempotency-Key` evita repetir o reenvio já
enfileirado/concluído. Usar uma chave nova para enviar novamente.

Erros:

- 404: Nota não encontrada ou não pertence ao tenant
- 409: Nota não autorizada ou documentos ainda não preparados
- 422: Cliente não possui e-mail cadastrado

**Webhook `nfse.invoice.documents_ready`**: Disparado quando os documentos fiscais ficam prontos. Payload:

```json
{
  "id": "evt_<timestamp>_<random>",
  "type": "nfse.invoice.documents_ready",
  "environment": "live|test",
  "createdAt": "2026-10-09T12:00:00Z",
  "data": {
    "invoiceId": "uuid",
    "documentsReadyAt": "2026-10-09T12:00:00Z",
    "accessKey": "chave da nfe",
    "nfseNumber": 123,
    "companyId": "uuid",
    "status": "authorized",
    "documentsStatus": "ready",
    "emailStatus": null,
    "stage": "documents_ready"
  }
}
```

**Estado da nota em todo webhook `nfse.invoice.*`**: `data` sempre inclui
`invoiceId`, `companyId`, `environment`, `status` (estado **fiscal**),
`documentsStatus`, `emailStatus` e `stage`, com o mesmo significado dos campos
de `GET /invoices/{id}`. `data.status` nunca é o estado do e-mail. Os eventos
`email_sent` (com `sentAt`) e `email_failed` trazem `emailStatus` `sent`/`failed`.

**RequestOtp**: `channel`, `purpose`, `target`, `contextId?`.
**VerifyOtp**: mesmos campos + `code`. ContextId é obrigatório para
`payment_authorization` e `consent_confirmation`. Canal email tem adapter;
WhatsApp não tem adapter registrado neste módulo e retorna indisponibilidade.
Para login, usar as duas rotas `/auth/magic-link`, que também criam sessão.

| Campo                        | Valores                                                                                                                                                                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `role` em convite            | `admin`, `developer`, `billing`                                                                                                                                                                                                         |
| API key `environment`        | `live`, `test`                                                                                                                                                                                                                          |
| API key `scope`              | `full_access`, `invoices_issue`, `invoices_view`, `invoices_read_write`                                                                                                                                                                 |
| `plan_slug` / `slug`         | `free`, `developer`, `growth`, `scale`, `volume`                                                                                                                                                                                        |
| `cycle`                      | `monthly`, `annual`                                                                                                                                                                                                                     |
| Empresa / nota `environment` | `test`, `live`; somente leitura na resposta                                                                                                                                                                                             |
| `taxRegime`                  | `MEI`, `Simples Nacional`, `Lucro Presumido`, `Lucro Real`                                                                                                                                                                              |
| Nota `status`                | `queued`, `processing`, `authorized`, `rejected`, `retry_pending`, `reconciliation_required`, `manual_review`, `failed`                                                                                                                 |
| Webhook `events`             | `nfse.invoice.authorized`, `nfse.invoice.rejected`, `nfse.invoice.failed`, `nfse.invoice.reconciliation_required`, `nfse.invoice.manual_review`, `nfse.invoice.documents_ready`, `nfse.invoice.email_sent`, `nfse.invoice.email_failed`, `nfse.invoice.fiscal_discrepancy` |
| OTP `channel`                | `email`, `whatsapp`                                                                                                                                                                                                                     |
| OTP público `purpose`        | `email_verification`, `phone_verification`, `login_challenge`, `account_recovery`, `magic_link_login`                                                                                                                                   |
| OTP autenticado `purpose`    | Públicos + `payment_authorization`, `consent_confirmation`                                                                                                                                                                              |

Datas são strings ISO no JSON. Valores `*Cents` e `*_cents` são centavos.
`ListInvoices.limit` aceita 1–100. `stripeSessionId` atualmente é inteiro
opcional; não corresponde ao identificador textual de Checkout real.

## Validação fiscal e status da empresa

> **Mudança de contrato (2026-10-10):** dados fiscais inválidos agora retornam
> **400**. Antes eram aceitos e persistidos.

### Formatos de erro 400

**Erro fiscal** (validação de domínio), todos os problemas juntos, um item por campo:

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "code": "validation_error",
  "message": ["taxId must be a valid CNPJ"],
  "details": [
    {
      "field": "taxId",
      "code": "invalid_cnpj",
      "message": "taxId must be a valid CNPJ"
    }
  ]
}
```

`field` usa ponto para campos aninhados (`address.zip`, `customer.address.state`,
`service.code`). Mostrar mensagens traduzidas a partir de `code`; `message`
está em inglês.

**Erro estrutural** (`ValidationPipe`): formato padrão do Nest,
`{ statusCode, error, message: string[] }`, sem `details`. Cobre tipo errado,
tamanho excedido e campo desconhecido (`whitelist` + `forbidNonWhitelisted`:
não enviar campos fora do contrato).

| code                                              | Quando                                                         |
| ------------------------------------------------- | -------------------------------------------------------------- |
| `required` / `blank`                              | Campo ausente / string vazia                                   |
| `invalid_cnpj` / `invalid_cpf` / `invalid_tax_id` | Documento inválido (`invalid_tax_id` = CPF ou CNPJ do tomador) |
| `invalid_cep`                                     | CEP sem 8 dígitos                                              |
| `invalid_uf`                                      | UF inexistente                                                 |
| `invalid_ibge_code`                               | Código de município sem 7 dígitos                              |
| `invalid_service_code`                            | `service.code` sem exatamente 6 dígitos                        |
| `invalid_decimal_places`                          | `amount` com mais de 2 casas                                   |
| `out_of_range`                                    | `amount` <= 0 ou acima de 9.999.999.999,99                     |
| `future_date` / `invalid_date`                    | `competenceDate` futura / inválida                             |
| `incomplete_address`                              | Endereço do tomador com só `city` ou só `state`                |

### Empresa

- `taxId`: CNPJ válido (inclui CNPJ alfanumérico, IN RFB 2.229/2024), com ou
  sem máscara. É persistido só com os caracteres do CNPJ, sem pontuação.
- `municipalReg`: opcional. `""` retorna `blank`. No PATCH, `null` limpa o
  campo e omitir mantém o valor.
- `address.state`: UF válida. `address.zip`: 8 dígitos (normalizado).
  No PATCH, `address: null` limpa o endereço.
- Não enviar `""` em campo opcional: omitir.
- `environment` é imutável e vem do header `X-Corvo-Environment`, não do body.

### `status` e `setupGaps`

As respostas de `POST/GET/PATCH /companies` trazem `setupGaps: string[]`
dentro de `data`. O front não deve calcular "empresa pronta"; usar a API.

| Gap                      | Significado                                         |
| ------------------------ | --------------------------------------------------- |
| `municipal_registration` | Falta inscrição municipal. Exigido apenas em `live` |
| `certificate`            | Não há certificado ativo                            |

`status` é `ready` quando `setupGaps` está vazio, senão `pending_setup`.
`blocked` nunca é alterado automaticamente. O status é recalculado ao criar ou
editar a empresa e ao enviar ou revogar certificado; refazer o GET depois
dessas ações.

### Nota (`POST /invoices`)

- `customer` é **opcional**. Se ausente ou vazio (`{}`), a nota é de
  consumidor: `customerSnapshot` fica `null` e o tomador **não** é enviado na
  DPS. Se enviado parcialmente, os campos ausentes recebem o padrão
  (`name: 'Consumidor'`, cidade `SIM`, UF `SS`). `customer.taxId` (CPF/CNPJ
  válido) é obrigatório apenas quando informado; `customer.email` é obrigatório
  se o envio por e-mail estiver ligado. `customer.address`: se enviar `city` ou
  `state`, os dois são obrigatórios; `state` é UF válida.
- `discount`: opcional. >= 0, <= `amount`, no máximo 2 casas decimais (decimal
  string ou number). Valores inválidos retornam 422 com o issue fiscal
  correspondente (`out_of_range` / `invalid_decimal_places`).
- `service.code`: exatamente 6 dígitos (cTribNac). `service.municipalityCode`:
  opcional, 7 dígitos se enviado. `service.description`: opcional.
- `service.fiscal`: objeto **opcional** de classificação — `nbsCode` (9
  dígitos), `cst` (3 dígitos), `classCode` (6 dígitos), `operationIndicator` (6
  dígitos) e `serviceProfileId` (uuid). Usado pelo motor fiscal como override
  da classificação; campos ausentes são preenchidos pelo perfil de serviço da
  empresa.
- `amount`: > 0, no máximo 2 casas decimais.
- `competenceDate`: data válida e não futura.

> **Motor fiscal (IBS/CBS):** o `POST /invoices` é assíncrono: a nota passa por
> um pipeline fiscal (perfil fiscal, classificação, aplicabilidade, ISS e
> retenções, IBS/CBS, validação) e só então é emitida. **Erros fiscais não
> voltam no `POST`**: a nota fica `rejected` e o motivo está em `lastErrorCode`
> (e no webhook `nfse.invoice.rejected`, com `errorCode` e `errorMessage`).
> Códigos principais: `FISCAL_PROFILE_MISSING`, `FISCAL_PROFILE_NOT_EFFECTIVE`,
> `FISCAL_REVIEW_REQUIRED`, `FISCAL_CLASSIFICATION_REQUIRED|INVALID|AMBIGUOUS`,
> `TAX_APPLICABILITY_UNKNOWN`, `TAX_REGIME_UNSUPPORTED`, `TAX_RATE_NOT_FOUND`,
> `TAX_CALCULATION_UNAVAILABLE|UNSUPPORTED`, `OPERATION_DOCUMENT_UNSUPPORTED`,
> `DPS_LAYOUT_UNSUPPORTED` e `DPS_SCHEMA_VALIDATION_FAILED`.
>
> - MEI e Simples Nacional em 2026 **não** calculam IBS/CBS (a ausência dos
>   campos é tolerada até 31/12/2026).
> - Regime regular: o IBS/CBS é calculado pela Calculadora de Tributos oficial
>   (rede privada da Corvo) com a **data da competência**. Com a Calculadora
>   fora do ar a nota **não** é rejeitada de imediato: o processamento é
>   reentregue com backoff (`TAX_CALCULATION_UNAVAILABLE` só aparece depois de
>   esgotadas as tentativas). Sem Calculadora configurada e com
>   `FISCAL_IBSCBS_UNAVAILABLE_MODE=block` (padrão), IBS/CBS obrigatório é
>   recusado em vez de emitido incompleto.
> - Competências a partir de **2027-01-01** no regime regular retornam
>   `TAX_RATE_NOT_FOUND`: o motor oficial ainda não tem as alíquotas e a Corvo
>   não usa alíquotas estimadas.
> - A DPS declara só a **classificação** de IBS/CBS (CST e cClassTrib); os
>   valores são consolidados pela Sefin na nota autorizada.

**Conciliação fiscal.** Depois de `authorized`, a Corvo compara os valores
calculados com os da NFS-e autorizada, sem alterar o XML. Se a diferença
passar da tolerância (R$ 0,01 por tributo) é enviado `nfse.invoice.fiscal_discrepancy`
com `data`: `invoiceId`, `companyId`, `environment`, `status` (estado fiscal da
nota, `authorized`) e `differences[]` (`field`, `local`, `authorized`, `delta`,
`kind`: `amount | missing_in_authorized | missing_locally`). O payload não traz
XML nem documentos completos.

## MCP (Model Context Protocol) e conexão de apps de IA

Permite que um app de IA (por exemplo Claude) emita e consulte NFS-e em nome
do usuário, via OAuth 2.1 + PKCE. Base: `https://api.corvo.tech`. As rotas
ficam sob `/v1` (prefixo da API), exceto o manifesto de descoberta.

| Item          | Valor                                                                  |
| ------------- | ---------------------------------------------------------------------- |
| Manifesto     | `GET https://api.corvo.tech/.well-known/mcp.json` (sem `/v1`, público) |
| Endpoint MCP  | `https://api.corvo.tech/v1/mcp` (JSON-RPC, `POST`)                     |
| Authorization | `GET https://api.corvo.tech/v1/mcp/authorize`                          |
| Token         | `POST https://api.corvo.tech/v1/mcp/token`                             |
| Revogação     | `POST https://api.corvo.tech/v1/mcp/revoke`                            |
| `client_id`   | `corvo-mcp` (cliente público, sem secret)                              |
| Escopos       | `nfse:read`, `nfse:write`                                              |

### Fluxo de autorização

1. O app de IA abre no navegador do usuário:
   `GET /v1/mcp/authorize?client_id=corvo-mcp&redirect_uri=...&response_type=code&scope=nfse:read nfse:write&code_challenge=...&code_challenge_method=S256&state=...`
   Todos os parâmetros são obrigatórios. `code_challenge_method` só aceita
   `S256`. O `redirect_uri` precisa estar cadastrado no backend
   (`MCP_REDIRECT_URIS`), senão retorna 400 `invalid_request`.
2. O backend redireciona para a **página de consentimento**
   `/v1/mcp/consent`, renderizada pelo backend (HTML, tema escuro Corvo). O
   usuário precisa ter **sessão ativa** (cookie `corvo_session`); sem ela a
   rota retorna 401. **O front deve garantir que o usuário esteja logado
   antes de seguir o link de autorização**, ou redirecionar ao login e voltar
   para a URL de `authorize`.
3. Na página o usuário escolhe o workspace (tenant) e aprova. O backend
   redireciona para o `redirect_uri` com `code` e `state`. O código expira em
   5 minutos.
4. O app troca o código por tokens:

```http
POST /v1/mcp/token
Content-Type: application/x-www-form-urlencoded   (JSON também é aceito)

grant_type=authorization_code&code=...&code_verifier=...&redirect_uri=...&client_id=corvo-mcp
```

```json
{
  "access_token": "...",
  "token_type": "Bearer",
  "expires_in": 900,
  "refresh_token": "...",
  "scope": "nfse:read nfse:write"
}
```

O access token vale 15 minutos. Renovar com
`grant_type=refresh_token&refresh_token=...`. O refresh token vale 1 ano.
Erros seguem o padrão OAuth: `{ "error": "invalid_grant", "error_description": "..." }`. 5. O app chama `POST /v1/mcp` com `Authorization: Bearer <access_token>`.

### Ferramentas (`tools/call`)

| Tool                | Escopo       | Entrada principal                                                                                                                                                                                        | Saída                                                            |
| ------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `nfse_issue`        | `nfse:write` | `company_id`, `customer {name, tax_id, email?, address?}`, `services [{description, quantity, unit_price}]`, `competence_date` (`YYYY-MM-DD`), `service_code?`, `municipality_code?`, `idempotency_key?` | `{ invoice_id, access_key, status }` (status inicial `queued`)   |
| `nfse_query`        | `nfse:read`  | `access_key`                                                                                                                                                                                             | `{ access_key, status, nfse_number, authorized_at, last_error }` |
| `nfse_list`         | `nfse:read`  | `status?`, `limit?` (máx. 100), `cursor?`                                                                                                                                                                | `{ invoices, next_cursor }`                                      |
| `nfse_download_pdf` | `nfse:read`  | `access_key`                                                                                                                                                                                             | `{ access_key, pdf_base64 }` (só nota autorizada)                |

`nfse_issue` soma `quantity * unit_price` dos itens para formar o `amount` e
junta as descrições em uma só. As mesmas regras de validação fiscal da API
REST valem aqui (ver "Validação fiscal e status da empresa").

### Gerenciamento de conexões no front ("Aplicativos conectados")

Rotas JSON autenticadas pelo **cookie de sessão** (não usam Bearer nem
`X-Corvo-Environment`). Chamar com `credentials: 'include'`.

**GET /v1/mcp/connections** - lista as conexões do usuário. Retorna array direto
(sem envelope `data`):

```json
[
  {
    "id": "uuid",
    "tenant_id": "uuid",
    "tenant_name": "Empresa Exemplo",
    "scopes": ["nfse:read", "nfse:write"],
    "granted_at": "2026-10-10T12:00:00.000Z",
    "last_used_at": null,
    "revoked": false
  }
]
```

**DELETE /v1/mcp/connections/{id}** - revoga a conexão e invalida a sessão do
app. Retorna `{ "ok": true }`. Pede também o contexto do workspace ativo.

Sugestão de UI: tela "Aplicativos conectados" em Configurações listando
`tenant_name`, escopos em linguagem simples (`nfse:read` = "Consultar e baixar
notas", `nfse:write` = "Emitir e cancelar notas"), data de concessão, último
uso e botão "Revogar". Marcar `revoked: true` como "Revogado" e sem ação. O
backend também serve uma versão HTML pronta em `GET /v1/mcp/dashboard`.

### Instruções para quem for conectar um app de IA

- URL do servidor MCP a informar ao app: `https://api.corvo.tech/v1/mcp`.
- O usuário será levado ao navegador para aprovar o acesso. Mostrar no front
  uma explicação antes (o que o app poderá fazer) e o link para gerenciar ou
  revogar depois.

### Limitações atuais (importante)

- **A MCP sempre opera no ambiente `test`.** O token não carrega ambiente, e o
  backend assume `test`. Notas emitidas por MCP são de teste e não aparecem em
  `live`. Não prometer emissão real ao usuário por esse caminho.
- **Descoberta OAuth automática não está completa.** O manifesto
  `/.well-known/mcp.json` não anuncia os endpoints OAuth e não existe
  `/.well-known/oauth-authorization-server`. Clientes que dependem dessa
  descoberta precisam receber as URLs acima configuradas manualmente.
- **`service_code` padrão da MCP (`06990`) tem 5 dígitos** e falha na validação
  de 6 dígitos da API. Enquanto isso não for corrigido no backend, o app de IA
  deve enviar `service_code` com 6 dígitos (ex.: `010101`).
- O `GET /v1/mcp/dashboard` redireciona após revogar para `/mcp/dashboard`
  (sem `/v1`). Prefira a lista JSON acima na UI do front.

## Formato das respostas e erros

O código atual não tem envelope global. Auth, sessão, API keys, magic link,
plans, billing, companies e OTP retornam `{data: ...}`. Certificados,
credits, webhooks e health retornam objeto/array diretamente.
Notas e eventos ainda são entidades de domínio serializadas como
`{props: {...}}`, ou array desses objetos. `/credits/plans` também retorna
entidades de plano com `props`. Não aplicar `response.data.data` a todas as
rotas; conferir cada contrato. PDF/XML são arquivos, usar `response.blob()`
ou `response.text()`, não `response.json()`.

| Status | Tratamento sugerido                                                                                     |
| ------ | ------------------------------------------------------------------------------------------------------- |
| 400    | Campos inválidos; `code: validation_error` traz `details[]` por campo (ver seção de validação fiscal)   |
| 401    | Sem sessão, sessão expirada ou `OTP_INVALID_OR_EXPIRED`                                                 |
| 403    | Permissão insuficiente, membership inativo ou CSRF/origem inválidos                                     |
| 404    | Recurso/rota inexistente ou PDF/XML indisponível                                                        |
| 409    | Conflito, incluindo e-mail já associado a workspace Free, documento indisponível ou nota não autorizada |
| 429    | Respeitar `Retry-After`; aguardar para reenviar código                                                  |
| 422    | Entidade não processável, ex: e-mail ausente na nota                                                    |
| 503    | Dependência/entrega indisponível; não assumir que o e-mail chegou                                       |

## Pendências reais antes de integrar funcionalidades completas

- **OAuth Google/GitHub**: caminhos foram normalizados para `/v1`, mas o
  controller ainda exige sessão, não valida `state` e emite cookies próprios
  incompatíveis com a política de sessão. Não habilitar os botões como login
  funcional antes de corrigir esse fluxo, configurar credenciais/callbacks e
  testar com os provedores. O authorize retorna JSON `{url}`, não redireciona.
- **Pagamento**: `/billing/upgrade` muda plano sem validar pagamento, e
  `/credits/purchase/confirm` concede créditos sem consultar o provedor.
  Não tratar uma chamada do navegador como comprovação de pagamento.
  Checkout e confirmação confiável via servidor/webhook precisam ser ligados.
- **Convite**: `/auth/invite` cria usuário/membership, mas não envia convite
  por e-mail. O usuário convidado pode iniciar login por código.
- **E-mail**: a configuração está no `.env`; entrega externa pelo MillionSend
  ainda precisa ser validada com destinatário real. Testes do login substituem
  somente a entrega, mantendo Postgres, Redis, OTP e guards reais.
- **Emissão fiscal**: existência das rotas e boot não comprovam emissão junto
  ao serviço nacional. O teste de integração valida SDK real, assinatura/XSD,
  persistência, reconciliação e débito usando transporte HTTP controlado.
  Emissão real ainda depende do cadastro fiscal e certificado reais.
- Não existem rotas de login por senha, refresh JWT, cadastro separado,
  CRUD de tenants, atualização de perfil ou cancelamento de nota neste inventário.

Teste HTTP de login com schema isolado:

```sh
MIGRATION_TEST_DATABASE_URL=postgresql://corvo:changeme@localhost:5434/corvo_test \
AUTH_TEST_REDIS_URL=redis://localhost:6381 \
yarn test --runInBand --runTestsByPath src/modules/auth/http/passwordless.postgres.integration.spec.ts
```

Teste fiscal com API e worker reais, PostgreSQL local (banco `corvo_test`),
Redis e S3 compatível local na porta 4566:

```sh
yarn test:fiscal:integration
```

Cria schema, prefixo Redis e bucket exclusivos e os limpa ao terminar.
Somente e-mail, entrega de webhook e HTTP fiscal externo são substituídos;
autenticação, banco, filas, SDK, certificado, XML, PDF e S3 são reais.
Não exige certificado do usuário e não emite notas no governo.

Na API/worker locais, configurar as mesmas variáveis `STORAGE_S3_*` do
`.env.example` para PDF/XML. URLs públicas de bucket não são necessárias.
Para upload de certificado live, definir `NFSE_MASTER_KEY` (mínimo 32
caracteres) e mantê-la estável para descriptografar certificados. Reiniciar
API e worker após mudar o `.env`. Templates de e-mail exigem credenciais
válidas do provedor e alias `nfse-documents-ready`.
