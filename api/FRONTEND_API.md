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

Em `live`, exige empresa com certificado PKCS#12 válido
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
| POST   | `/auth/invite`                                         | S, `settings.manage`            | JSON: `email`, `name`, `role`; cria convite pendente e envia o link por e-mail; 201 |
| GET    | `/auth/invitations`                                    | S, `settings.manage`            | Convites pendentes e não expirados                                                 |
| POST   | `/auth/invitations/{id}/resend`                        | S, `settings.manage`            | Novo link e novos 7 dias; o link anterior deixa de valer; 429 em menos de 1 min    |
| DELETE | `/auth/invitations/{id}`                               | S, `settings.manage`            | Cancela o convite                                                                  |
| POST   | `/auth/invitations/preview`                            | S                               | JSON: `token`; papel e quem convidou; só para o e-mail convidado                   |
| POST   | `/auth/invitations/accept`                             | S                               | JSON: `token`; cria a membership, avisa o admin principal; devolve `tenantId`      |
| PATCH  | `/auth/profile`                                        | S                               | JSON: `name` (1 a 100); o nome da própria pessoa. `GET /auth/session` devolve `profile: {name, email}` |
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
| GET    | `/companies/{id}/fiscal-profile`                       | S/K, `nfse.companies.view`      | Histórico de perfis e vigências; 200                                               |
| PUT    | `/companies/{id}/fiscal-profile`                       | S/K, `nfse.companies.manage`    | Cria vigência fiscal; `confirm: true` aprova pelo ator; idempotente se idêntica; 200 |
| POST   | `/companies/{id}/fiscal-profile/{profileId}/approve`   | S/K, `nfse.companies.manage`    | Aprova o perfil fiscal; 201                                                        |
| GET    | `/companies/{id}/service-tax-profiles`                 | S/K, `nfse.companies.view`      | Perfis de serviço vigentes em `?date=YYYY-MM-DD`; 200                               |
| POST   | `/companies/{id}/service-tax-profiles`                 | S/K, `nfse.companies.manage`    | Cria perfil de serviço; 201                                                        |
| PATCH  | `/companies/{id}/service-tax-profiles/{serviceId}`     | S/K, `nfse.companies.manage`    | Atualiza perfil de serviço; restrições de imutabilidade dos aprovados; 200           |
| POST   | `/companies/{id}/service-tax-profiles/{serviceId}/approve` | S/K, `nfse.companies.manage` | Aprova o perfil de serviço (idempotente se já aprovado); 201                          |
| DELETE | `/companies/{id}/service-tax-profiles/{serviceId}`     | S/K, `nfse.companies.manage`    | Remove só perfil expirado e não aprovado; aprovado ou vigente retorna 409            |
| POST   | `/invoices/calculate`                                  | S/K, `nfse.invoices.issue`      | Cálculo pré-emissão sempre disponível; CreateInvoice; 200 ready/blocked; rate limit HTTP padrão |
| POST   | `/invoices/batches`                                    | S/K, `nfse.invoices.issue`      | Emite 1 a 50 notas (várias empresas); `{ invoices: [CreateInvoice + idempotencyKey?] }`; resultado por item (`index`, `accepted`/`rejected`, `replayed?`); válidas salvas em uma transação; 10 req/min por tenant; 202 |
| POST   | `/invoices`                                            | S/K, `nfse.invoices.issue`      | JSON CreateInvoice; header `idempotency-key?`; 202                                 |
| GET    | `/invoices`                                            | S/K, `nfse.invoices.view`       | Query: `companyId?`, `status?`, `from?`, `to?`, `externalId?`, `limit?`, `cursor?` |
| GET    | `/invoices/{id}`                                       | S/K, `nfse.invoices.view`       | Detalhes/status da nota                                                            |
| GET    | `/invoices/{id}/events`                                | S/K, `nfse.invoices.view`       | Histórico de transições                                                            |
| GET    | `/invoices/{id}/xml`                                   | S/K, `nfse.invoices.view`       | Arquivo XML; nota autorizada ou cancelada após autorização                                                    |
| GET    | `/invoices/{id}/pdf`                                   | S/K, `nfse.invoices.view`       | Arquivo PDF; nota autorizada ou cancelada após autorização                                                    |
| POST   | `/invoices/{id}/download-url`                          | S/K, `nfse.invoices.view`       | Body: `{format: "pdf"                                                              | "xml"}`; URL pré-assinada para download |
| POST   | `/invoices/{id}/email`                                 | S/K, `nfse.invoices.issue`      | Header `Idempotency-Key`; reenvia e-mail da nota; 202                              |
| POST   | `/invoices/{id}/substitute`                            | S/K, `nfse.invoices.issue`      | JSON: `description` (15–255), `service.description?`, `purchaseOrder?`, `notes?`; header `idempotency-key?`; 202; só nota `authorized` (409 `ERROR_INVOICE_NOT_SUBSTITUTABLE`) |
| GET    | `/customers`                                           | S/K, `nfse.invoices.view`       | Query: `search?`, `limit?`, `cursor?`; clientes salvos, mais recente primeiro |
| GET    | `/customers/{taxId}`                                   | S/K, `nfse.invoices.view`       | Cliente salvo por CPF/CNPJ (com ou sem pontuação); 404 se não existe |
| PATCH  | `/customers/{taxId}`                                   | S/K, `nfse.invoices.issue`      | JSON: `name?`, `email?` (`null` apaga) |
| DELETE | `/customers/{taxId}`                                   | S/K, `nfse.invoices.issue`      | Apaga o cadastro; as notas emitidas não mudam |
| POST   | `/invoices/{id}/cancel`                                | S/K, `nfse.invoices.issue`      | JSON: `reason`, `description?`; 200 (queued → cancelled) ou 202 (authorized → cancelling; processing → pedido registrado) |
| GET    | `/webhooks`                                            | S/K, `webhooks.view`            | Lista sem segredo                                                                  |
| POST   | `/webhooks`                                            | S/K, `webhooks.manage`          | JSON: `url`, `events`; retorna segredo na criação; 201                             |
| DELETE | `/webhooks/{id}`                                       | S/K, `webhooks.manage`          | Exclui configuração                                                                |
| POST   | `/webhooks/{id}/test`                                  | S/K, `webhooks.manage`          | Envia evento de teste; 201                                                         |
| GET    | `/webhooks/deliveries`                                 | S/K, `webhooks.view`            | Query: `hours?` (até 720), `limit?`, `cursor?`, `environment=live\|test`, `invoice_id?`, `event_type?`, `status?`; padrão 24h |
| GET    | `/webhooks/deliveries/stats`                           | S/K, `webhooks.view`            | Query: `hours?`, `environment?`; total/sent/failed/pending/delayed                 |
| POST   | `/webhooks/deliveries/{id}/retry`                      | S/K, `webhooks.manage`          | Reenvio manual; 200                                                                |
| POST   | `/public/security/turnstile/verify`                    | Público                         | JSON: `token` (ou `response` / `cfTurnstileResponse`); 201                         |
| POST   | `/public/security/otp/challenges`                      | Público                         | JSON RequestOtp; retorna desafio; 202                                              |
| POST   | `/public/security/otp/challenges/{challengeId}/verify` | Público                         | JSON VerifyOtp; retorna prova, sem criar sessão; 201                               |
| POST   | `/security/otp/challenges`                             | S                               | JSON RequestOtp; retorna desafio; 202                                              |
| POST   | `/security/otp/challenges/{challengeId}/verify`        | S                               | JSON VerifyOtp; retorna prova; 201                                                 |
| GET    | `/health/live`                                         | Público                         | Liveness                                                                           |
| GET    | `/health/ready`                                        | Público                         | Readiness de banco/Redis                                                           |

## Integrações de pagamento

Conectam Woovi, AbacatePay ou Stripe à Corvo para emitir a NFS-e a cada
pagamento confirmado. Detalhes e exemplos na página "Integrações de pagamento"
da documentação. Caminhos relativos a `/v1`; `S/K` = sessão ou chave de API.

| Método | Caminho                                      | Acesso / permissão                | Entrada / uso                                                         |
| ------ | -------------------------------------------- | --------------------------------- | --------------------------------------------------------------------- |
| GET    | `/integrations/providers`                    | S/K, `integrations.view`          | Plataformas e campos de credencial (sem valores)                      |
| POST   | `/integrations/connections`                  | S/K, `integrations.manage`        | JSON: `provider`, `companyId`, `environment`, `credentials`, `activeFrom?` |
| GET    | `/integrations/connections`                  | S/K, `integrations.view`          | Lista; cada item traz `webhookUrl`, nunca credenciais                 |
| GET    | `/integrations/connections/{id}`             | S/K, `integrations.view`          | Detalhe da conexão                                                    |
| POST   | `/integrations/connections/{id}/validate`    | S/K, `integrations.manage`        | Confere credenciais e grava a conta externa                           |
| POST   | `/integrations/connections/{id}/activate`    | S/K, `integrations.manage`        | Exige conta validada, ao menos uma regra e, em `live`, empresa pronta     |
| POST   | `/integrations/connections/{id}/pause`       | S/K, `integrations.manage`        | Eventos continuam guardados; nada é emitido                           |
| POST   | `/integrations/connections/{id}/disconnect`  | S/K, `integrations.manage`        | Definitivo                                                            |
| GET    | `/integrations/connections/{id}/rules`       | S/K, `integrations.view`          | Regras de serviço                                                     |
| PUT    | `/integrations/connections/{id}/rules`       | S/K, `integrations.manage`        | JSON: `rules[]` com `externalProductId?`, `service`, `sendEmail`, `allowAnonymousCustomer?`, `cancelOnRefund?` (padrão `false`: pede o cancelamento da nota quando o reembolso chega depois dela); substitui tudo |
| GET    | `/integrations/connections/{id}/events`      | S/K, `integrations.view`          | Query: `limit` (ajustado a 1..100); sem o corpo do evento            |
| GET    | `/integrations/connections/{id}/operations`  | S/K, `integrations.view`          | Query: `limit`; vendas com `fiscalStatus` e `blockReason`             |
| PATCH  | `/integrations/operations/{id}/customer`     | S/K, `integrations.manage`        | JSON: `taxId`, `name?`, `email?`; só antes de o pedido ser fixado     |
| POST   | `/integrations/operations/{id}/retry`        | S/K, `integrations.manage`        | Tenta emitir de novo; reaproveita o pedido já fixado                  |
| POST   | `/integrations/inbound/{publicId}`           | Público, autenticado pelo conector | Chamado pela plataforma de pagamento; sempre `200` quando aceito     |

## Payloads e enums

**CreateCompany**: obrigatórios `legalName`, `taxId`, `taxRegime`
(`MEI` ou `Simples Nacional`; outros regimes retornam `422 ERROR_TAX_REGIME_NOT_SUPPORTED`) e
`municipalityCode` (código IBGE de 7 dígitos, em `test` e `live`).
Opcionais `tradeName`, `municipalReg` (opcional; guardada, mas **não enviada** na nota a menos que `sendMunicipalReg` seja `true`, padrão `false` — a Receita rejeita com E0120 se o município não tiver o dado), `defaultServiceCode`
(cTribNac de 6 dígitos), `simpleNational`, `specialRegime`, `address`.
UpdateCompany aceita os mesmos campos, todos opcionais (`defaultServiceCode:
null` remove o padrão). Address: `street`, `number`, `complement`, `district`,
`city`, `state`, `zip`, todos opcionais.

O regime tributário **não fica na empresa**: `taxRegime`, `simpleNational` e
`specialRegime` do body criam o primeiro perfil fiscal, vigente desde hoje e
**já aprovado** pelo usuário ou chave de API que fez a chamada (`reviewedBy`).
Declarar o regime na requisição é a confirmação. `simpleNational` omitido
acompanha o regime (`true` para MEI e Simples Nacional). As respostas de
`/companies` devolvem esses três campos lidos do perfil fiscal aberto;
`taxRegime` é `null` se a empresa não tem perfil. `PATCH` com campo de regime,
quando o regime efetivo muda, grava um novo perfil aprovado vigente desde hoje:
se o perfil aberto começou em data anterior, ele é encerrado hoje e um novo é
criado; se começou hoje, retorna 409 `profile_validity_conflict` (o perfil
aprovado não é reescrito no mesmo dia). Para mudar o regime numa data futura,
use `PUT /companies/{id}/fiscal-profile` com `validFrom` (anterior ao início do
perfil aberto retorna 422).

```json
{
  "legalName": "Empresa Exemplo LTDA",
  "taxId": "11222333000181",
  "taxRegime": "MEI",
  "municipalReg": "12345",
  "municipalityCode": "3550308"
}
```

**CreateInvoice**: obrigatórios `service`, `amount`,
`competenceDate` e a empresa, informada por `companyId` (uuid) **ou**
`companyTaxId` (CNPJ, com ou sem pontuação); pelo menos um dos dois. Se vierem
os dois, vale o `companyId`. Empresa inexistente no tenant/ambiente retorna 404.
Opcionais `customer`, `discount` (number), `externalId`, `email` (boolean) e `options: {type?: "IMMEDIATE" | "SCHEDULE"}`.
`IMMEDIATE` é o padrão. Com `SCHEDULE`, envie `competenceDate` futura em
`YYYY-MM-DD`; `data.scheduledFor` retorna a data ISO de liberação às
00:00 em `America/Sao_Paulo` (ou `null` para emissão imediata). A nota permanece
`queued` até esse instante. Datas além do horizonte configurado (15 dias por
padrão) retornam HTTP 422 com issue code `schedule_horizon_exceeded`.

O aceite persiste a nota, o evento e a mensagem da outbox na mesma transação.
Depois que a publicação é confirmada, um reset do Redis pode perder o job e
manter a nota em `queued`; o scheduler de recuperação de documentos não
recupera esse caso.
Amount é valor monetário, mínimo 0.01. Customer é opcional conforme regime/operação;
quando presente aceita `taxId`, `name`, `email` e `address` (inclui
`municipalityCode` IBGE de 7 dígitos). `service.code` e
`service.municipalityCode` herdam os padrões da empresa quando omitidos;
`description`, `service.fiscal` e `service.serviceProfileId` são opcionais. Ver "Validação fiscal e
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
  "email": true
}
```

`code` é o código nacional de tributação de seis dígitos. O exemplo serve
ao simulador; em live, usar os códigos e cadastro fiscal reais da empresa.
Enviar CPF/CNPJ sem pontuação e competência como `YYYY-MM-DD`.

**Nota fiscal**: `POST /invoices` retorna 202 com `{data: {...}}` (a nota, sem `props`) em estado
`queued`; não significa que a nota já está autorizada. Buscar
`GET /invoices/{id}` até `status === 'authorized'` e
`documentsReadyAt !== null`, ou acompanhar webhooks. A resposta inclui:

| Campo                    | Tipo                                                      | Descrição                                                                |
| ------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------ |
| `environment`        | `test\|live`                                              | Ambiente persistido da nota                                              |
| `documentsReadyAt`   | `string\|null`                                            | Data ISO; quando preenchida, XML/PDF estão prontos                       |
| `lastEmailStatus`    | `queued\|sent\|failed\|null`                              | Estado do último envio                                                   |
| `lastEmailSentAt`    | `string\|null`                                            | Data ISO do último envio                                                 |
| `documentsStatus`    | `pending\|ready`                                          | Estado dos documentos (derivado de `documentsReadyAt`)                   |
| `emailStatus`        | `queued\|sent\|failed\|null`                              | Igual a `lastEmailStatus`; `null` = e-mail ainda não enviado/enfileirado |
| `stage`              | `pending\|authorized\|documents_ready\|completed\|failed` | Visão calculada do ciclo (não é armazenada)                              |

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
- 409: Nota não autorizada ou `documentsReadyAt` ainda nulo
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

**POST /invoices/{id}/cancel** - Cancela uma nota.

Body: `{ "reason": "issue_error" | "service_not_provided" | "other", "description"?: string }`.

- Nota `queued` (agendada ou ainda não processada): cancelada na hora, `200` com `status: "cancelled"`. Em live, o crédito reservado é estornado. `description` é opcional.
- Nota `authorized`: `202` com `status: "cancelling"`. O evento 101101 é enviado à Sefin em segundo plano. `description` é obrigatória (15–255 caracteres). Resultado: `cancelled` (webhook `nfse.invoice.cancelled`) ou de volta a `authorized` com `lastErrorCode/lastErrorMessage` (webhook `nfse.invoice.cancellation_rejected`). O crédito não é devolvido. Após a rejeição da Sefin, a nota volta a `authorized` mantendo `cancellationReason`/`cancellationDescription` do último pedido (um novo pedido os sobrescreve).
- Nota `processing` (em emissão): `202` com a nota ainda `processing` e `cancellationRequestedAt` preenchido (o pedido fica registrado). `description` é obrigatória (15–255 caracteres). Assim que a nota for autorizada, ela é cancelada automaticamente na Sefin (evento 101101), sem devolver o crédito; se a emissão terminar `rejected` ou `failed`, o pedido é descartado e a reserva é estornada como de costume. Repetir o pedido devolve o estado atual (vale o primeiro pedido).
- Nota `retry_pending`, `reconciliation_required` ou `manual_review`: `409 ERROR_INVOICE_NOT_CANCELLABLE`.
- Nota já `cancelling`/`cancelled`: devolve o estado atual.
- Erros: `409 ERROR_INVOICE_NOT_CANCELLABLE` (outros status, como `retry_pending`, `reconciliation_required` e `manual_review`), `422 ERROR_INVALID_CANCELLATION_REASON`. Se outro pedido já cancelou a nota, devolve o estado atual.
- Campos novos na invoice: `cancellationReason`, `cancellationDescription`, `cancelledAt`, `cancellationRequestedAt` (pedido feito enquanto a nota estava em emissão). XML/PDF continuam disponíveis depois do cancelamento; o reenvio de e-mail não.

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
| `taxRegime`                  | `MEI`, `Simples Nacional`                                                                                                                                                                                                                |
| Nota `status`                | `queued`, `processing`, `authorized`, `rejected`, `retry_pending`, `reconciliation_required`, `manual_review`, `failed`, `cancelling` (cancelamento enviado à Sefin, aguardando resposta), `cancelled` (nota cancelada)                                                                                                             |
| Webhook `events`             | `nfse.invoice.authorized`, `nfse.invoice.rejected`, `nfse.invoice.failed`, `nfse.invoice.reconciliation_required`, `nfse.invoice.manual_review`, `nfse.invoice.documents_ready`, `nfse.invoice.email_sent`, `nfse.invoice.email_failed`, `nfse.invoice.fiscal_discrepancy`, `nfse.invoice.cancelled`, `nfse.invoice.cancellation_rejected` |
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
  sem máscara. É persistido só com os caracteres do CNPJ, sem pontuação. **Não
  pode ser alterado**: no `PATCH`, o CNPJ atual é aceito e ignorado; outro valor
  retorna 422.
- `municipalReg`: obrigatória ao criar empresa em `live` (422 `required`);
  opcional em `test`. `""` retorna `blank`. No PATCH, `null` limpa o campo e
  omitir mantém o valor.
- `municipalityCode`: obrigatório, 7 dígitos (`invalid_ibge_code`).
- `defaultServiceCode`: opcional, 6 dígitos (`invalid_service_code`). É só um
  padrão da empresa; a classificação fiscal vem do perfil do serviço.
- `simplesRate`: **obrigatório para Simples Nacional** (422 `required`), ignorado
  para MEI. Alíquota efetiva total (%) do DAS, ex.: `"6.54"` (0 a 100, até 2
  casas). Vai em toda nota (`pTotTribSN`). Para atualizar, mande o novo valor no
  `PATCH /companies/{id}`.
- `simplesIssRate`: opcional, só Simples Nacional (1,80 a 5,00). Necessária só
  quando algum cliente retém ISS. No PATCH, `null` remove.

### Configuração fiscal da empresa

Para MEI e Simples Nacional o fluxo é só este:

1. `POST /companies` com `taxRegime`, `municipalityCode`, `simplesRate` (só
   Simples Nacional) e, em `live`, `municipalReg`. O perfil fiscal já nasce
   aprovado.
2. `POST /companies/{id}/certificates` com o certificado A1.
3. `POST /invoices`.

Use `POST /invoices/calculate` para conferir a configuração antes de emitir.
O perfil de serviço **não é necessário** para emitir sem tomador ou para
tomador CPF: sem ele a classificação vem do catálogo oficial pelo `service.code`.
**Exceção:** quando o tomador é CNPJ, a retenção federal (IRRF, PIS, COFINS,
CSLL) depende da política do serviço, e sem perfil de serviço o cálculo é
bloqueado com `TAX_APPLICABILITY_UNKNOWN` e o campo pendente
`service.withholdingPolicy`. Cadastre o perfil do serviço com
`withholdingPolicy` `NONE_CONFIRMED` (sem retenção) ou `CONFIGURED` (com
`withholdingRates`) e aprove-o. O perfil também é exigido quando o regime pede
IBS/CBS ou ISS configurado (regime regular, a partir de 2027): o cálculo devolve
`FISCAL_CLASSIFICATION_REQUIRED` com os campos que faltam.

Configuração avançada (opcional):

- `GET|PUT /companies/{id}/fiscal-profile` lista e cria vigências (por exemplo,
  mudança de regime em data futura). `PUT` aceita `confirm: true` para já
  registrar a vigência aprovada; sem ele a vigência fica `unreviewed` e exige
  `POST .../fiscal-profile/{profileId}/approve`.
- `POST /companies/{id}/service-tax-profiles` cadastra a classificação e a
  tributação de um serviço (`serviceCode` de 6 dígitos, `effectiveFrom`), com
  `POST .../service-tax-profiles/{serviceId}/approve`. Em `live`, um perfil de
  serviço existente precisa estar `approved`, senão a nota é rejeitada com
  `FISCAL_REVIEW_REQUIRED`. Perfil aprovado é imutável (409
  `immutable_approved_profile`): para corrigir, crie outro com outra vigência.
- Perfil `rejected` bloqueia a emissão nos dois ambientes; vigência
  `unreviewed` em `live` também.

Permissões: `nfse.companies.view` (ler) e `nfse.companies.manage` (criar,
editar e aprovar).
- `address.state`: UF válida. `address.zip`: 8 dígitos (normalizado).
  No PATCH, `address: null` limpa o endereço.
- Não enviar `""` em campo opcional: omitir.
- `environment` é imutável e vem do header `X-Corvo-Environment`, não do body.

### `status` e `setupGaps`

As respostas de `POST/GET/PATCH /companies` trazem `setupGaps: string[]`
dentro de `data`. O front não deve calcular "empresa pronta"; usar a API.

| Gap                      | Significado                                         |
| ------------------------ | --------------------------------------------------- |
| `municipality_code`      | Código IBGE do município ausente ou sem 7 dígitos   |
| `municipal_registration` | Falta inscrição municipal. Exigido apenas em `live` |
| `certificate`            | Não há certificado ativo                            |

`setupGaps` cobre os dados cadastrais e o certificado. Uma empresa `ready`
emite sem passos extras para MEI e Simples Nacional (veja "Configuração fiscal
da empresa").

`status` é `ready` quando `setupGaps` está vazio, senão `pending_setup`.
`blocked` nunca é alterado automaticamente. O status é recalculado ao criar ou
editar a empresa e ao enviar ou revogar certificado; refazer o GET depois
dessas ações.

### Nota (`POST /invoices`)

- `customer` é **opcional**. Se ausente ou vazio (`{}`), a nota é de
  consumidor: `customerSnapshot` fica `null` e o tomador **não** é enviado na
  DPS. Se enviar qualquer dado do tomador (nome, e-mail, endereço), `customer.taxId`
  (CPF/CNPJ válido) é **obrigatório**; sem ele a API devolve 422 (`customer.taxId`,
  `required`). `name` é opcional (padrão `Consumidor`, cidade `SIM`, UF `SS` para o
  que faltar). `customer.email` é obrigatório
  se o envio por e-mail estiver ligado. `customer.address`: se enviar `city` ou
  `state`, os dois são obrigatórios; `state` é UF válida.
- `discount`: opcional. >= 0, <= `amount`, no máximo 2 casas decimais (number). Valores inválidos retornam 422 com o issue fiscal
  correspondente (`out_of_range` / `invalid_decimal_places`).
- `service.code`: opcional, exatamente 6 dígitos (cTribNac) quando enviado. Sem ele vale o
  `defaultServiceCode` da empresa e, se não houver, `100901` (LC 116 item 10.09,
  representação de qualquer natureza). `service.municipalityCode`: opcional, 7 dígitos se
  enviado. `service.description`: opcional; se vazia, usa o nome do código de serviço.
- `service.fiscal`: objeto **opcional** de classificação — `nbsCode` (9
  dígitos), `cst` (3 dígitos), `classCode` (6 dígitos), `operationIndicator` (6
  dígitos). `service.serviceProfileId` (uuid) é um campo separado de `fiscal`.
  Usado pelo motor fiscal como override da classificação; campos ausentes são preenchidos pelo perfil de serviço da
  empresa.
- `customer.foreign`: cliente no exterior; **substitui** `customer.taxId` e
  `customer.address` (enviar os dois junto dá 422 `not_allowed`) e exige
  `customer.name`. Campos: `taxId` (NIF, até 40) **ou** `noTaxIdReason`
  (`exempt` | `not_required`), `country` (ISO2, diferente de `BR`), `postalCode`
  (até 11), `city`, `region`, `street`, `number`, `district` (até 60 cada;
  `street` até 255) e `complement?` (até 156). Não declara exportação.
- Cliente salvo: se `customer.taxId` vem sem `name` e o documento já foi usado
  numa nota aceita, o nome vem do cadastro (`GET /customers`). Sem cadastro o
  nome sai como `Consumidor`.
- `purchaseOrder` (até 60, uma linha) e `notes` (até 2000): opcionais, vão na DPS
  em `serv/infoCompl` (`xPed`, `xInfComp`) e não mudam nenhum tributo.
- `amount`: > 0, no máximo 2 casas decimais.
- `competenceDate`: data válida e não futura, exceto com `options.type = SCHEDULE`.
  Emissão agendada é liberada às 00:00 em `America/Sao_Paulo`; a resposta inclui
  `scheduledFor`. O horizonte é `OUTBOX_SCHEDULE_MAX_DAYS` (15 dias por padrão).

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
>   campos é tolerada até 31/12/2026, segundo a orientação da CGNFS-e de 07/08/2026;
>   é referência, não prazo previsto em ato legal).
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

## Cálculo pré-emissão

`POST /v1/invoices/calculate` executa o mesmo motor fiscal do worker, de forma
síncrona, sem criar nota ou agendamento. Está **sempre disponível** para API
key/sessão autenticada com a permissão existente `nfse.invoices.issue`.
O ambiente vem da API key (ou `X-Corvo-Environment` da sessão).

O request é o mesmo de `CreateInvoiceDto`. Competência futura é aceita **sem**
`options.type`; continua valendo o horizonte `OUTBOX_SCHEDULE_MAX_DAYS`, 15 dias
por padrão. Nenhum `scheduledFor` é usado ou retornado pelo cálculo. São
selecionados os perfis vigentes na competência, inclusive quando futura.

```sh
curl --request POST 'https://api.corvo.tech/v1/invoices/calculate' \
  --header "x-api-key: $CORVO_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{"companyId":"11111111-1111-4111-8111-111111111111","service":{"code":"060101","description":"Corte de cabelo","municipalityCode":"3550308"},"amount":50,"competenceDate":"2026-10-13"}'
```

Pré-requisito do exemplo: empresa MEI no ambiente da chave, perfil fiscal
vigente na data e atividade de serviço permitida/configurada. Substitua o UUID
pelo da empresa real. O cálculo não exige certificado A1 nem `ensureReady`.
Veja [exemplos completos](../docs/fiscal/examples.md), com os perfis necessários.

Retorna HTTP **200** com `{ data: InvoiceCalculationResponse }` para resultados
fiscais, inclusive bloqueios. O front deve ler `data.status`:

| Campo | Contrato |
| --- | --- |
| `preEmission`, `disclaimer` | `true` e aviso de cálculo pré-emissão; os valores podem divergir da validação final da Sefin |
| `status` | `ready` ou `blocked`; `ready` não é autorização de emissão |
| `competenceDate`, `taxRegime` | Data usada no cálculo e regime do perfil efetivo (ou `null` se ainda não resolvido) |
| `classification` | Códigos e fonte, `catalogValidated`, `catalogVersions`; `null` se ainda não resolvida |
| `applicability` | Obrigações `iss`, `issWithheld`, `federalWithholding`, `cbs`, `ibs`, `specialTreatment`, estratégia e razões; `null` se ainda não resolvida |
| `taxes` | Somente os tributos calculados (`iss`, `cbs`, `ibsState`, `ibsCity`, `ibsTotal`); cada um com `base`, `rate`, `amount` como strings decimais |
| `withholdings` | Lista de retenções com `tax`, `base`, `rate`, `amount`; vazia se ainda não calculadas |
| `netReceivableAmount`, `collectionWaived` | String decimal e boolean; `null` quando ainda não determinados |
| `calculation` | `source: none|legacy|rtc|legacy+rtc`, `calculatorVersion`, `rulesVersion`, `legalReferences`; pode ser `null` |
| `warnings` | `{ code, message, step }[]` |
| `pendingFields` | `{ field, reason }[]` agregados do erro e das obrigações com configuração ausente |
| `blocking` | `null` em `ready`; `{ code, message, step, category, retryable, details }` em `blocked` |
| `trace` | `{ step, status: applied|skipped|failed, durationMs, reason? }[]` das etapas executadas |

Recorte de resposta MEI em 2026, sem tomador:

```json
{
  "data": {
    "preEmission": true,
    "status": "ready",
    "disclaimer": "Pre-emission calculation. Values are not a fiscal document and may differ from the final validation by Sefin.",
    "competenceDate": "2026-10-13",
    "taxRegime": "MEI",
    "taxes": {},
    "withholdings": [],
    "netReceivableAmount": "50.00",
    "collectionWaived": false,
    "pendingFields": [],
    "blocking": null
  }
}
```

Em `blocked`, `taxes`, `withholdings` e demais valores refletem **somente** as
etapas já calculadas; campos ausentes não são impostos iguais a zero. O payload
não ecoa CPF/CNPJ nem nome do cliente. Não grava em invoices, eventos,
sequências DPS, outbox, snapshots/conciliações fiscais, créditos ou entregas de
webhooks; não publica em BullMQ, não usa S3 e não chama a Sefin. A única
integração fiscal possível é com a **Calculadora RTC**, motor externo.

| HTTP | Quando / ação |
| --- | --- |
| 200 `blocked` | Falhas fiscais VALIDATION, CONFIGURATION, CLASSIFICATION, UNSUPPORTED ou CALCULATION. Corrigir `pendingFields`/`blocking`; não reenviar sem ajuste |
| 404 | Empresa inexistente no tenant/ambiente (`ERROR_COMPANY_NOT_FOUND`); nunca significa endpoint desativado |
| 400/422 | DTO inválido ou erro de normalização (`FiscalValidationError` ⇒ 422). Corrigir o request |
| 429 | Limite HTTP padrão; aguardar `Retry-After` e observar `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` |
| 503 | FiscalError INTEGRATION, como Calculadora RTC indisponível. Aguardar `Retry-After` antes de tentar novamente |
| 500 | Falha INTERNAL; mensagem genérica, sem mensagem original nem stack |

Usa o mesmo rate limit autenticado dos demais endpoints: por padrão,
`RATE_LIMIT_AUTHENTICATED=300` por minuto por API key/sessão, mais `RATE_LIMIT_TENANT=600` por tenant e 120/min por tenant na própria rota (`@Throttle`, fixo no código, sem variável de ambiente). `Retry-After` é em segundos:
no 503, `ceil(details.retryAfterMs/1000)`, mínimo 1, padrão 5.
Erros HTTP usam `{ statusCode, code, message, details?, requestId }` e códigos
públicos `ERROR_*`. Exemplo de indisponibilidade:

```http
HTTP/1.1 503 Service Unavailable
Retry-After: 5
Content-Type: application/json

{"statusCode":503,"code":"ERROR_TAX_CALCULATION_UNAVAILABLE","message":"Service temporarily unavailable","requestId":"request-id"}
```

Os códigos em `blocking.code` pertencem ao domínio e não levam o prefixo HTTP
`ERROR_`. A categoria e `retryable` vêm do erro efetivo; os códigos abaixo ajudam
a escolher a ação do cliente:

| Código fiscal | Categoria usual / retryable | Ação |
| --- | --- | --- |
| `FISCAL_PROFILE_MISSING`, `FISCAL_PROFILE_NOT_EFFECTIVE` | CONFIGURATION / false | Cadastrar vigência correta do perfil |
| `FISCAL_REVIEW_REQUIRED` | CONFIGURATION ou UNSUPPORTED / false | Revisar/aprovar configuração ou tratamento especial |
| `FISCAL_CLASSIFICATION_REQUIRED`, `FISCAL_CLASSIFICATION_INVALID`, `FISCAL_CLASSIFICATION_AMBIGUOUS` | CLASSIFICATION / false | Completar/corrigir códigos e resolver ambiguidade dos perfis |
| `FISCAL_VALIDATION_FAILED` | VALIDATION / false | Corrigir os campos indicados |
| `TAX_APPLICABILITY_UNKNOWN`, `TAX_RATE_NOT_FOUND` | CONFIGURATION ou CALCULATION / false | Configurar aplicabilidade/alíquota; não estimar |
| `TAX_REGIME_UNSUPPORTED`, `TAX_CALCULATION_UNSUPPORTED` | UNSUPPORTED / false | Cenário sem regra suportada; encaminhar ao responsável fiscal |
| `TAX_RULE_NOT_EFFECTIVE` | CONFIGURATION / false | Rever competência e vigência das regras |
| `OPERATION_DOCUMENT_UNSUPPORTED` | UNSUPPORTED / false | Operação GOODS/MIXED exige outro documento/módulo |
| `TAX_CALCULATION_UNAVAILABLE` | INTEGRATION / true | 503, repetir após `Retry-After` (sem estimar tributos) |
| `FISCAL_INTERNAL_ERROR` | INTERNAL / false | 500 genérico; investigar com `requestId` |
| `DPS_LAYOUT_UNSUPPORTED`, `DPS_SCHEMA_VALIDATION_FAILED` | UNSUPPORTED ou VALIDATION / false | Erros do fluxo de emissão; corrigir layout/schema, não são gerados por `calculate` |
| `TAX_RECONCILIATION_REQUIRED` | Sinal de conciliação / não é FiscalError do cálculo | Tratar divergência pós-autorização pelo runbook; não reenviar emissão |

Perfis de serviço usam `/companies/{id}/service-tax-profiles`, com
`service.serviceProfileId` no request. Não há endpoint `fiscal-services`.

## MCP (Model Context Protocol) e conexão de agentes de IA

Agentes (Claude Code, Cursor etc.) emitem e consultam NFS-e em nome do usuário.
Servidor: `https://api.corvo.tech/mcp`. O agente descobre o login sozinho
(`/.well-known/oauth-protected-resource` e `/.well-known/oauth-authorization-server`,
sem `/v1`; `/v1/mcp` continua funcionando), se registra (`POST /mcp/register`, RFC 7591) e usa OAuth 2.1 com
PKCE `S256`. Escopos: `nfse:read`, `nfse:write`. Um `401` em `POST /mcp` traz
`WWW-Authenticate` apontando para o recurso protegido.

### Fluxo (login e consentimento ficam no front)

1. O agente abre `GET /mcp/authorize?...` (API). A API valida o cliente e o
   `redirect_uri` e **redireciona para o front**: `${DASHBOARD_URL}/mcp/authorize?<mesmos parâmetros>`.
2. O front (`/mcp/authorize`) exige sessão. Sem sessão, leva ao login
   (`/login?mode=login&next=<url>`) e volta para a mesma URL depois.
3. A tela chama `GET /v1/mcp/consent?<parâmetros>` (cookie de sessão) e recebe
   `{ data: { client: {id,name}, redirect_host, scopes: [{name,description}], tenants: [{id,name,allowed_scopes}] } }`.
   Um workspace só pode ser escolhido se `allowed_scopes` cobre todos os escopos
   pedidos (depende do papel do membro: `nfse:write` exige emitir notas).
4. **Permitir/Negar**: `POST /v1/mcp/consent` com os mesmos parâmetros mais
   `decision: "allow" | "deny"`, `tenant_id` (obrigatório ao permitir) e
   `environment: "test" | "live"` (padrão `test`; a conexão fica nesse ambiente). Resposta
   `{ data: { redirect_url } }`. O front mostra "Conectado" e abre `redirect_url`
   (`?code=...&state=...`, ou `?error=access_denied&state=...`).
5. O agente troca o `code` em `POST /mcp/token` (sem cookie) e chama `/v1/mcp`
   com `Authorization: Bearer`. Access token: 15 min. Refresh token: 1 ano, rotacionado.

Os dois endpoints `consent` usam a sessão normal do painel (cookie + CSRF, via
proxy do Next). `redirect_uri` aceitos no registro: `https`, `http` em
`localhost`/`127.0.0.1` (a porta pode variar) ou esquema próprio do app.

### Ferramentas (`tools/call`)

| Tool                | Escopo       | Entrada principal                                                                                                                              | Saída                                                            |
| ------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `nfse_issue`        | `nfse:write` | `company_id`, `customer {name, tax_id, email?}`, `services [{description, quantity, unit_price}]`, `competence_date`, `service_code?`, `idempotency_key?` | `{ invoice_id, access_key, status }`                             |
| `nfse_cancel`       | `nfse:write` | `invoice_id`, `reason` (`issue_error` \| `service_not_provided` \| `other`), `description?` (15-255 caracteres, obrigatória para NFS-e autorizada ou em emissão) | `{ invoice_id, status, cancelled_at }` (`cancelled`, `cancelling` ou `processing` com o pedido registrado) |
| `nfse_substitute`   | `nfse:write` | `invoice_id`, `description` (15-255), `service_description?`, `purchase_order?`, `notes?` | `{ invoice_id, status, substitutes_invoice_id }` |
| `nfse_repeat` | `nfse:write` | `invoice_id` ou `access_key`, `amount?`, `description?`, `competence_date?` | `{ invoice_id, access_key, status, copied_from_invoice_id }` |
| `nfse_email_resend` | `nfse:write` | `invoice_id`, `email?` | `{ invoice_id, email_id, status }` |
| `company_update` | `nfse:write` | `company_id`, `trade_name?`, `municipality_code?`, `default_service_code?`, `address?` | `{ id, trade_name, municipality_code, default_service_code, address }` |
| `accountant_package_send` | `nfse:write` | `company_id` ou `tax_id`, `month?`, `confirm` (sem `true`, só prévia) | `{ sent, status, month, recipient, note_count }` |
| `service_favorite_list` | `nfse:read` | `company_id` | `{ favorites }` |
| `service_favorite_create` | `nfse:write` | `company_id`, `label`, `description`, `service_code`, `amount_cents?`, `municipality_code?` | favorito salvo |
| `service_favorite_delete` | `nfse:write` | `company_id`, `favorite_id` | `{ favorite_id, deleted: true }` |
| `customer_list`     | `nfse:read`  | `search?`, `limit?` (1-100), `offset?` | `{ customers, total, limit, offset }` |
| `customer_update`   | `nfse:write` | `tax_id`, `name?`, `email?` (`null` apaga) | `{ tax_id, name, email, last_used_at }` |
| `customer_delete`   | `nfse:write` | `tax_id` | `{ tax_id, deleted: true }` |
| `nfse_query`        | `nfse:read`  | `access_key`                                                                                                                                   | `{ access_key, status, nfse_number, authorized_at, last_error }` |
| `nfse_list`         | `nfse:read`  | `status?`, `limit?`, `cursor?`                                                                                                                 | `{ invoices, next_cursor }`                                      |
| `nfse_download_pdf` | `nfse:read`  | `access_key`, `inline?` | `{ access_key, download_url, expires_at, file_name, mime_type }` (link assinado, 1 hora); com `inline: true`, `{ access_key, pdf_base64 }` |

Falhas de ferramenta voltam como resultado `{ isError: true, content: [{type:"text", text}] }`.

### Agentes conectados no painel (`/app/agents`)

Rotas com sessão normal (cookie + CSRF), envelope padrão `{data, pagination}`:

- `GET /v1/mcp/connections` — cada item: `id`, `tenant_id`, `tenant_name`,
  `client_name`, `scopes`, `granted_at`, `last_used_at`, `tool_calls`,
  `invoices_issued`, `revoked`, `mine`, `owner_email`. Membros veem só as
  próprias; quem tem `settings.manage` (admin) vê todas do workspace.
- `DELETE /v1/mcp/connections/{id}` — revoga na hora (`{ data: { revoked: true } }`).
  Membro revoga as próprias; admin revoga qualquer uma do workspace.

Reconectar o mesmo agente reaproveita a conexão (e os contadores) e revoga a sessão anterior.

### Ambiente (test ou live)

O usuário escolhe o ambiente na tela de consentimento e a conexão fica nele: o
token do agente opera em `test` ou `live` (empresas, notas e créditos daquele
ambiente). Para trocar, reconectar o agente (a conexão é reaproveitada e passa
para o novo ambiente). `GET /v1/mcp/connections` devolve `environment` em cada item.

## Formato das respostas e erros

O código atual não tem envelope global. Auth, sessão, API keys, magic link,
plans, billing, companies e OTP retornam `{data: ...}`. Certificados,
credits, webhooks e health retornam objeto/array diretamente.
Notas, eventos, planos e transações de crédito também vêm planos (sem `props`):
`{data: {...}}` ou `{data: [...], pagination}`. Não aplicar `response.data.data` a todas as
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
- **Convite**: `/auth/invite` cria um convite pendente e envia por e-mail um link
  com token de uso único (7 dias; só o hash fica no banco). A pessoa entra com o
  mesmo e-mail e aceita em `/accept-invite`; só então vira membro e o admin
  principal recebe um e-mail avisando.
- **E-mail**: a configuração está no `.env`; entrega externa pelo MillionSend
  ainda precisa ser validada com destinatário real. Testes do login substituem
  somente a entrega, mantendo Postgres, Redis, OTP e guards reais.
- **Cálculo pré-emissão**: `ready` e testes locais não substituem homologação
  na Sefin, nem confirmação fiscal das regras. MEI/Simples sem opção pelo regime regular
  emitem sem IBS/CBS em 2027; veja [limitações](../docs/fiscal/limitations.md).
- **Emissão fiscal**: existência das rotas e boot não comprovam emissão junto
  ao serviço nacional. O teste de integração valida SDK real, assinatura/XSD,
  persistência, reconciliação e débito usando transporte HTTP controlado.
  Emissão real ainda depende do cadastro fiscal e certificado reais.
- Não existem rotas de login por senha, refresh JWT, cadastro separado,
  CRUD de tenants ou atualização de perfil neste inventário.

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
