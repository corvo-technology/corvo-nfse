# Admin da plataforma

Data: 2026-11-23. Status: rascunho para aprovação do dono.

## 1. Intenção

O dono da Corvo hoje não tem como ver a plataforma inteira nem agir sobre uma conta sem mexer no banco. Ele quer, dentro da própria Corvo:

- ver os usuários e o que cada um faz;
- dar notas avulsas para um usuário, sem pagamento;
- ver os números da plataforma: notas emitidas, rejeições, receita.

O modelo é o que foi feito na Rookbox (`~/Documents/rookbox`). Do admin do produto Rookbox vem a entrada por lista de e-mails numa variável de ambiente. Do console de operador da Rookbox vêm as telas e a auditoria de toda ação.

## 2. Objetivos, não objetivos e anti-objetivos

**Objetivos (primeira versão)**
1. Visão geral da plataforma.
2. Lista de usuários com busca.
3. Detalhe do usuário.
4. Dar notas avulsas, com motivo obrigatório.
5. Lista "precisa de atenção".
6. Histórico de ações do admin.

**Não objetivos (ficam para depois)**
- Entrar como o usuário (impersonação).
- Suspender ou excluir conta.
- Trocar plano ou mexer em assinatura do Stripe.
- Tirar notas de um usuário (estorno de bônus).
- Gráficos elaborados. Números e listas bastam na primeira versão.
- Vários níveis de admin (papéis). É um admin só, o dono.

**Anti-objetivos (seria falha mesmo funcionando)**
- Um usuário comum conseguir ver ou chamar qualquer coisa do admin, ou até descobrir que ele existe.
- Uma ação do admin acontecer sem ficar registrada.
- O caminho de leitura de todos os clientes conseguir escrever dados.
- Uma nota dada pelo admin aparecer como receita.
- Expor dados sensíveis desnecessários: chave de API inteira, certificado, senha do certificado, tokens.

## 3. Restrições

- **Isolamento por cliente.** Cada cliente só enxerga os próprios dados, com RLS no Postgres (`api/TENANT_ISOLATION.md`). A leitura de todos os clientes só pode acontecer por um caminho próprio, só de leitura, que nunca recebe entrada do cliente.
- **O proxy do web só deixa passar rotas que estão numa lista** (`web/app/api/proxy/[...path]/route.ts`, `routes[]`). As rotas do admin precisam entrar nela.
- **Self-hosted.** Com `DEPLOYMENT_MODE=self_hosted` não há billing, e o ledger de créditos é no-op. Nesse modo, o admin esconde créditos, planos, pagamentos e a ação "dar notas", e mantém usuários, empresas e notas.
- **Simplicidade.** O dono prefere poucas variáveis e explicações sem jargão. Uma variável nova só: `PLATFORM_ADMIN_EMAILS`.

## 4. Abordagens consideradas

| | Como é | Prós | Contras |
|---|---|---|---|
| **A, escolhida** | Área `/app/admin` dentro do painel que já existe, com o mesmo login. Só e-mails de `PLATFORM_ADMIN_EMAILS` acessam. | Reaproveita login, sessão, layout e componentes. Um deploy só. | O admin vive no mesmo app dos clientes, então o guard do servidor precisa estar certo. |
| B | App de admin separado, com host próprio, como o console de operador da Rookbox. | Mais isolado. | Mais um app para subir, manter e autenticar. |
| C | Só API e comando no terminal, como o admin do produto Rookbox. | Rápido de fazer. | Não atende "ver tudo" numa tela. |

O dono escolheu a **A**.

## 5. O design

### 5.1 Quem é admin

- **Variável `PLATFORM_ADMIN_EMAILS`:** lista separada por vírgula, comparada em minúsculas e sem espaços. Vazia ou ausente significa que ninguém é admin. Esse é o padrão. Não há fallback para "o primeiro usuário", diferente da Rookbox, porque na Corvo o cadastro é aberto.
- **A conta precisa ter e-mail verificado.** Se o e-mail estiver na lista mas não estiver verificado, a conta não é admin.
- **Onde se define:** em `AuthContextService.buildForAuthUser`, que preenche os campos que já existem e estão sem uso em `auth-context.ts` (`isPlatformAdmin`, `contextType: 'platform'`). Só vale para login por sessão (cookie). Chave de API e conexão MCP nunca são admin.
- **`GET /auth/session`** passa a devolver `isPlatformAdmin: boolean`, para o web mostrar ou esconder o menu.

### 5.2 Proteção da API

- **Rotas novas sob `/v1/platform/*`**, num módulo `platform-admin`, sem `@ApiKeyEndpoint`.
- **`PlatformAdminGuard`** em todo o controller:
  - sem sessão, ou sessão de quem não é admin, responde **404** (`NOT_FOUND` padrão), para não revelar que a rota existe;
  - toda recusa vira um log de aviso com o usuário e a rota.
- **A barreira é o guard.** Não usar como proteção o desvio `isPlatformRoute` do `TenantContextGuard` nem o decorator `@AllowPlatformAdminPermissionBypass`. Eles só pulam checagens de tenant e não autenticam ninguém.
- **Rate limit:** os limites globais já existentes bastam.

### 5.3 Leitura de todos os clientes

- **Um novo `SystemPurpose` `'platform-admin'`** e um repositório próprio, `PlatformAdminReadRepository`, **só com SELECT**:
  - consultas agregadas e paginadas por cursor, como o resto do código;
  - nenhum método de escrita;
  - entradas validadas: ids em UUID e busca com texto limitado.
- **Nunca devolver:**
  - a chave de API inteira (só `key_prefix`);
  - o conteúdo do certificado ou a senha;
  - tokens de sessão;
  - a coluna `checkout` (jsonb) de `payment_intents` em bruto.

### 5.4 Telas (web, `/app/admin`)

O menu "Admin" na sidebar só aparece quando `isPlatformAdmin` é verdadeiro. A página checa no servidor e devolve 404 para quem não é admin. O gate do web é só experiência; a proteção real é a API. Português, no mesmo estilo do painel.

1. **Visão geral** (`/app/admin`):
   - usuários: total e novos em 7 e 30 dias;
   - notas de **produção**: autorizadas hoje, em 7 e em 30 dias, e rejeitadas no mesmo período, com a taxa de rejeição;
   - notas de **teste** num número separado;
   - receita confirmada em 7 e 30 dias, pela soma de `payment_intents` com status pago, separada em assinatura e avulso;
   - notas dadas pelo admin, que **não** contam como receita.
2. **Usuários** (`/app/admin/users`): tabela paginada, com busca por e-mail, nome ou CNPJ de empresa. Colunas:
   - e-mail, nome e data de cadastro;
   - plano;
   - notas de produção no mês;
   - saldo avulso;
   - número de empresas;
   - última atividade, que é a mais recente entre a última nota, o último uso de chave de API, o último uso de MCP e o último login.
3. **Detalhe do usuário** (`/app/admin/users/:id`):
   - dados da conta e os workspaces de que participa, com o papel em cada um;
   - por workspace:
     - plano e uso do mês;
     - saldo avulso;
     - empresas, com CNPJ, município, ambiente e validade do certificado;
     - últimas 20 notas, com status, valor, ambiente e o código do último erro;
     - histórico de créditos;
     - pagamentos;
     - chaves de API (prefixo, ambiente e último uso);
     - conexões MCP (cliente e último uso).
   - botão **"Dar notas avulsas"**.
4. **Precisa de atenção** (`/app/admin/attention`):
   - notas em `manual_review`, `reconciliation_required` ou `retry_pending` há mais de 1 hora;
   - certificados vencendo em até 15 dias;
   - entregas de webhook falhando nas últimas 24 horas;
   - pagamentos falhados.
   Cada item leva ao detalhe do usuário.
5. **Histórico do admin** (`/app/admin/audit`): lista do registro de ações, a mais recente primeiro.

O usuário (pessoa, em `auth_users`) é diferente do workspace (`tenants`). Convidados participam de workspaces de outras pessoas. A lista parte do usuário, e o detalhe mostra cada workspace dele.

### 5.5 Dar notas avulsas

- **`POST /v1/platform/tenants/:tenantId/credit-grants`** com o corpo `{ amount, reason, notifyUser }`, mais o cabeçalho `Idempotency-Key` obrigatório. O web gera essa chave a cada abertura do formulário.
  - `amount`: inteiro de 1 a 500.
  - `reason`: texto obrigatório, de 5 a 500 caracteres.
  - `notifyUser`: o padrão é `false`.
- **Reaproveita `CreditsService.grantBonus`**, executado em `runWithTenant(tenantId)`, não em system. O método ganha `metadata`, com quem deu, o motivo e a chave de idempotência.
  - O lançamento continua `type: 'bonus', source: 'bonus'`. Assim entra no saldo avulso, não expira e não conta como receita.
  - **Não usar `grantAvulso`**, porque ele é `purchase` e mistura com receita.
- **O workspace precisa existir**, senão responde 404.
- **Idempotência:** a mesma `Idempotency-Key` não gera um segundo lançamento e devolve o resultado do primeiro.
- **Auditoria na mesma transação** (5.6). Se a gravação do registro falhar, o crédito também não é gravado.
- Com `notifyUser`, publica o aviso `credits-added`, que já existe, para o usuário receber o e-mail.
- **No web**, um modal com a quantidade e o motivo, e uma confirmação simples ("Dar 10 notas para fulano@x.com?").
- **No self-hosted**, a rota responde 404 e o botão não aparece.

### 5.6 Registro de ações (auditoria)

- **Tabela nova `platform_admin_audit_events`**, sem RLS, nunca exposta aos clientes. Colunas:
  - `id`;
  - `actor_user_id` e `actor_email`;
  - `action`, por exemplo `credit_grant`;
  - `target_tenant_id` e `target_user_id`;
  - `reason`;
  - `payload` (jsonb com os detalhes, como `amount` e a chave de idempotência);
  - `success`;
  - `ip_hash`;
  - `created_at`.
- **Grava toda ação de escrita do admin, inclusive as que falharem.** É fail-closed: se o registro não puder ser gravado, a ação não acontece.
- **Visualizar o detalhe de um usuário também grava um registro** (`action: 'user_viewed'`), porque são dados de clientes. A lista e a visão geral não gravam.
- **Retenção:** guardar para sempre na primeira versão, porque o volume é baixo.

### 5.7 Último login

- Não existe hoje. Passa a ser gravado numa coluna nova, `auth_users.last_login_at`, atualizada no `markLogin`, que já roda em todo login (código, Google e GitHub).
- É uma migração simples. Usuários antigos ficam com o campo vazio até o próximo login.

## 5.8 Decisões técnicas (respostas à revisão do builder)

Estas são decisões de quem escreveu o design, não do dono. Elas fecham pontos que a revisão levantou.

1. **O admin não entra no contexto de tenant.**
   - `isPlatformAdmin` continua `false` em todo contexto montado por `buildForAuthUser`, e `contextType` continua `'tenant'`. Assim o dono não perde permissões nos workspaces em que é membro (`route-permission.service.ts:19-21` negaria rotas para um principal admin).
   - Quem decide é o `PlatformAdminGuard`, que **recalcula a cada requisição**, fora do cache de contexto (`AuthContextCacheService`):
     - pega a sessão do cookie;
     - lê o `auth_users` do usuário;
     - confere o e-mail com `PLATFORM_ADMIN_EMAILS` e a verificação (item 4).
   - Tirar um e-mail da variável vale no próximo request, depois de reiniciar o processo que lê a env.
   - `GET /auth/session` calcula `isPlatformAdmin` do mesmo jeito.
   - As rotas `/v1/platform/*` não exigem tenant ativo: o guard de tenant é dispensado nelas pelo próprio `PlatformAdminGuard`, não por `isPlatformRoute`. Mesmo assim, todo usuário logado tem um workspace próprio, criado no primeiro login.
2. **Leitura de todos os clientes, de fato só leitura.**
   - O caminho `platform-admin` roda cada consulta dentro de uma transação com `SET TRANSACTION READ ONLY`. O Postgres recusa qualquer escrita, mesmo com `app.system_context='on'`.
   - Há um teste que tenta escrever por esse caminho e espera erro.
   - Sem role nova no banco.
3. **Auditoria e crédito.**
   - **Sucesso:** o registro de sucesso é gravado na **mesma transação e na mesma conexão** do lançamento de crédito. Se ele falhar, o crédito volta atrás (fail-closed).
   - **Falha:** se a ação falhar, um registro de falha é gravado depois, numa transação separada. Se até esse registro falhar, vira log de erro. A ação já falhou, então não há o que recusar.
   - O plano precisa garantir que o insert na tabela de auditoria (sem RLS) use a mesma transação aberta dentro de `runWithTenant(tenantId)`.
4. **E-mail verificado** é `auth_users.email_verified_at IS NOT NULL`.
   - O plano confere que o login por código preenche esse campo e que Google e GitHub só preenchem com e-mail verificado pelo provedor.
   - Se algum fluxo não preencher, o plano corrige o fluxo. O admin nunca é liberado sem essa verificação.
5. **Idempotência da concessão.**
   - `platform_admin_audit_events` tem a coluna `idempotency_key` com índice único parcial (`WHERE action = 'credit_grant' AND success`).
   - **Mesma chave com o mesmo valor e o mesmo motivo:** devolve o resultado original, sem novo crédito.
   - **Mesma chave com dados diferentes:** responde 409 `IDEMPOTENCY_KEY_REUSED`.
   - O web gera uma chave nova a cada vez que abre o formulário. Se a resposta se perder, repetir o envio com a mesma chave é seguro.
   - Sem migração em `credit_transactions`.
6. **Receita** precisa incluir as renovações de assinatura.
   - O plano confere onde as cobranças recorrentes do Stripe ficam registradas: se em `payment_intents`, ou só em `tenant_billing` e `webhook_events`.
   - Se as renovações não estiverem no banco, o plano passa a gravá-las a partir do webhook de fatura paga do Stripe que já é processado, ou mostra na tela, com esse nome, só "receita avulsa e primeiras cobranças". Nunca um número que pareça completo sem ser.
   - Valores exatos de `kind` e `status`: o plano lê do código.
7. **"Última atividade" é calculada só para a página atual** (até 50 usuários), com subconsultas limitadas. Sem desnormalizar na primeira versão.
8. **Detalhe do usuário** é um endpoint só. Grava um `user_viewed` por carregamento da página.

## 6. Decidido

- **Abordagem A:** `/app/admin` no painel e `/v1/platform/*` na API, com uma variável de ambiente.
- **O conteúdo da primeira versão** é o da seção 5.4.
- **Dar notas usa bônus:** não é receita e não expira, com motivo obrigatório.
- **Não-admin recebe 404.**
- **Self-hosted:** o admin funciona sem as partes de billing.

## 7. Fica para quem construir

- Desenho visual das telas, seguindo os componentes do painel.
- Índices novos que as consultas agregadas precisarem. Medir com `EXPLAIN` em dados realistas; `nfse_invoices` por `created_at` e `status` provavelmente precisa de um.
- Tamanho de página e formato do cursor.
- Testes:
  - o guard: 404 para não-admin, para chave de API e para MCP;
  - a idempotência;
  - a auditoria fail-closed;
  - o self-hosted;
  - o caminho de leitura nunca escrever;
  - o proxy ganhar as rotas novas.
- Documentar `PLATFORM_ADMIN_EMAILS` no `.env.example`, no `deploy/README.md` e no `SELF_HOSTING.md`.
