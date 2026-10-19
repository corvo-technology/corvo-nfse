# Modo self-hosted e abertura do projeto

Data: 2026-10-19. Status: rascunho para revisão do dono do projeto.

Convenções: **[decidido]** veio do dono do projeto. **[decisão minha]** é uma escolha do autor da spec, sujeita a revisão. **[em aberto]** só o dono pode responder.

## 1. Intenção

Abrir o código do Corvo NFS-e de modo que uma pessoa ou empresa consiga rodá-lo na própria infraestrutura, **sem conta no Stripe, sem limite de notas e sem a vitrine comercial**, e que uma instância usada por uma pessoa só não fique exposta a estranhos.

Hoje isso não funciona: o self-hosted nasce no plano Free (3 notas por dia, 1 empresa ativa), exige chaves do Stripe para subir, exige provedor de e-mail para qualquer login e mostra a landing page comercial na raiz.

## 2. Objetivos, não objetivos e anti-objetivos

**Objetivos**
1. Um flag de implantação desliga billing, créditos e limites, e a instância emite sem teto.
2. A instância self-hosted mostra apenas o produto (`/app`, `/login`) e a documentação da API (`/docs`, público **[decidido]**).
3. Uma instância de uso pessoal fica fechada por padrão: só o administrador definido entra.
4. O primeiro acesso funciona sem provedor de e-mail.
5. O repositório pode ser tornado público sem vazar dados pessoais nem acoplamento com a marca antiga.
6. Subir o stack exige poucos passos e imagens prontas para api e web.

**Não objetivos**
- Cobrança entre usuários da mesma instância self-hosted.
- Editor de planos ou preços na interface.
- Mudar a experiência da versão hospedada em `corvo.tech` (modo `cloud`).
- Suporte a outros provedores de pagamento.

**Anti-objetivos (seria falha mesmo que "funcione")**
- Desligar o billing da nuvem por acidente. O modo `cloud` precisa continuar sendo o comportamento de quem não configura nada.
- Um self-hoster ter de recompilar a imagem do web para trocar o modo.
- Uma instância "fechada" que ainda envia e-mails de login para qualquer endereço (vira relé de spam).
- Perder a chave mestra dos certificados por falta de aviso e backup.

## 3. Restrições

- **Licença AGPL-3.0 mantida [decidido].** Ver seção 9.
- Stack atual: NestJS 11, TypeORM com RLS no PostgreSQL, Redis, Next.js (com `proxy.ts`), Docker Compose, Dokploy em produção.
- A produção tem 1 tenant e nenhum cliente pagante (confirmado na sessão de 18/10), então mudanças de nome de cookie e de prefixo no Redis custam, no máximo, um novo login.
- O ambiente `test` fiscal já não consome créditos; só `live` reserva (`invoice-lifecycle.service.ts`).
- A calculadora RTC é um jar do governo (1,5 GB de memória, cerca de 7 minutos para subir). Não é nosso código.

## 4. Visão geral e ordem de entrega

Quatro subprojetos independentes, nesta ordem. Cada um vira um plano e um PR próprio.

| # | Subprojeto | Resultado |
|---|---|---|
| A | Modo `self_hosted` (API + web) | Sem Stripe, sem limites, só `/app`, config em runtime |
| B | Segurança de instância pessoal | Cadastro fechado, administrador definido, primeiro acesso sem e-mail |
| C | Prontidão para tornar público | Dados pessoais e marca antiga removidos, histórico limpo, política de segurança |
| D | Distribuição e setup | Imagens no GHCR, backup, perfis de tamanho, guia de upgrade |

C não depende de A e B e pode andar em paralelo. D depende de A e B.

## 5. Subprojeto A: modo self_hosted

### 5.1 O flag

`DEPLOYMENT_MODE=cloud|self_hosted`.

- **[decisão minha]** O padrão **no código** é `cloud`. Um deploy que não define nada continua como hoje. Quem desliga o billing precisa pedir explicitamente.
- **[decisão minha]** `scripts/setup-env.mjs` grava `DEPLOYMENT_MODE=self_hosted` em `deploy/.env` e `deploy/.env.local`. A produção em `corvo.tech` define `cloud` explicitamente no Dokploy.
- Validação no `env.schema.ts`: valor fora do enum falha a subida. Em `self_hosted`, `STRIPE_*` deixa de ser exigido e `PAYMENT_ALLOWED_PROVIDERS` assume vazio por padrão. Em `cloud`, nada muda.

### 5.2 O que muda no modo self_hosted

A troca é feita por injeção de dependência, não por `if` nos serviços de domínio.

| Ponto | Comportamento |
|---|---|
| `QuotaService` (`modules/plans/application/quota.service.ts`) | Uma implementação ilimitada: `canEmit` sempre verdadeiro, sem limite diário, de empresas ou de créditos. `assertCanEmit` e `assertCanCreateCompany` não lançam. |
| `BillingUsageService` | `reserve` não grava reserva nem transação de crédito; `settle` não faz nada. `status` devolve valores neutros. |
| `invoice-lifecycle.service.ts` | Nenhuma `credit_transaction` é criada. A emissão segue o mesmo caminho. |
| Plano | Um plano `self-hosted` é semeado e atribuído a todo tenant novo (`PasswordlessWorkspaceService`) no lugar do Free. Ele existe para o vínculo e para exibição; os limites vêm da implementação ilimitada, não das colunas do plano. **[decisão minha]** assim não é preciso tornar `maxActiveCompanies` anulável. |
| `BillingController`, `StripeWebhookController`, `CreditsController` | Não são registrados. As rotas respondem 404 com código `BILLING_DISABLED`. |
| Jobs de `billing.scheduler.ts`, `credits-low.notifier`, `free-abuse-checker` | Não são registrados. |
| Rate limit | Continua ativo. É proteção, não monetização. |
| Turnstile | Opcional. Sem chave configurada, o passo é pulado (já é o comportamento do PR #48). |

Contagem de notas emitidas para estatística continua vindo da própria tabela de notas (`invoice-overview`), sem depender de créditos.

**Migração de modo.** Trocar `cloud` por `self_hosted` numa instância com tenants existentes reatribui esses tenants ao plano `self-hosted` na subida. A volta de `self_hosted` para `cloud` não é suportada nem testada **[decisão minha]**; documentar como "não faça".

### 5.3 Configuração pública em runtime

`GET /v1/config`, público, sem autenticação, cacheável por 60 segundos.

```json
{
  "deploymentMode": "self_hosted",
  "billingEnabled": false,
  "signupMode": "closed",
  "turnstileSiteKey": null
}
```

Motivos: o web hoje lê `NEXT_PUBLIC_*` em tempo de build, o que forçaria o self-hoster a recompilar a imagem; e a site key do Turnstile do PR #48 tem o mesmo problema. O web busca essa config no servidor (layout) e a repassa aos componentes. Se a chamada falhar, assume o comportamento mais restritivo: sem billing, sem landing, cadastro fechado.

Nenhum segredo vai nesse endpoint. A site key do Turnstile é pública por natureza.

### 5.4 Web: só o produto

Quando `deploymentMode=self_hosted`, `web/proxy.ts` (que já lê variáveis de ambiente em runtime, como `SITE_ACCESS_MODE`) passa a:

- Redirecionar `/` e `/{locale}` para `/app`. Sem sessão, `/app` leva a `/login`.
- Responder 404 para `brand`, `dpa`, `privacy`, `terms`, `security` e `status`, que descrevem a empresa Corvo e não a instância.
- Manter `/docs` e `/docs/*` **públicos [decidido]**.
- Manter `/login`, `/app/*`, `/mcp/authorize`.

Também:
- `robots.ts` devolve `Disallow: /` e `sitemap.ts` fica vazio, para a instância não ser indexada. **[decisão minha]** o `/docs` também deixa de ser indexado, pois a documentação oficial fica em `corvo.tech`.
- Navegação: ocultar billing, pricing, widget de créditos da sidebar e qualquer aviso de upgrade ou "plano Free".
- A tela de login ganha uma variante sem chamadas comerciais ("Start free", links para preços).
- O seletor de plano e as mensagens de limite não aparecem; no lugar, a sidebar mostra "Self-hosted".

## 6. Subprojeto B: segurança de instância pessoal

### 6.1 Problema

Hoje qualquer e-mail que peça um código ganha um workspace novo. Numa instância exposta e de uso pessoal, estranhos criam tenants, gastam storage e usam o envio de e-mail da instância.

### 6.2 Controle de cadastro

`AUTH_SIGNUP_MODE=open|allowlist|closed`.

- **[decisão minha]** Padrão `closed` em `self_hosted` e `open` em `cloud`.
- `ADMIN_EMAIL`: esse endereço sempre pode entrar e vira o primeiro administrador.
- `AUTH_ALLOWED_EMAILS` e `AUTH_ALLOWED_DOMAINS` (listas separadas por vírgula) valem em `allowlist`.
- Usuários convidados pelo fluxo existente (`invitation.service`) sempre podem entrar, em qualquer modo.
- Usuários que já existem não são afetados por mudar o modo.

**Pontos de aplicação.** A checagem precisa vir **antes** de qualquer efeito colateral:
1. `MagicLinkService.requestCode`: se o e-mail não é permitido, devolve a mesma resposta de sucesso de hoje, sem gerar código nem enviar e-mail. Isso impede usar a instância para spam e impede descobrir quais e-mails são aceitos.
2. `social-auth.service`: recusar o cadastro de provedor para e-mail não permitido.
3. `PasswordlessWorkspaceService.ensureWorkspace`: última barreira antes de criar o tenant.

### 6.3 Primeiro acesso sem provedor de e-mail

`docker compose run --rm api node dist/scripts/create-admin.js`, que imprime uma URL de login de uso único.

- O token tem validade curta (15 minutos), é guardado apenas como hash e é consumido na primeira resposta.
- Só existe com `DEPLOYMENT_MODE=self_hosted`. Em `cloud`, o comando recusa.
- Quem roda o comando já tem acesso ao shell e às chaves da instância, então ele não amplia a superfície. **[decisão minha]** pode ser reexecutado para recuperar acesso.
- O endpoint que consome o token fica sob rate limit e registra auditoria (`sensitive-auth-audit.service`).

Sem provedor de e-mail configurado, a interface avisa que o login por código está indisponível e orienta a usar o comando.

### 6.4 Exposição de rede e dados

- Manter o bind padrão em `127.0.0.1` para api e web. Documentar três modos: **local**, **privado** (Tailscale, VPN ou Cloudflare Access na frente) e **público** (Caddy ou Dokploy com HTTPS).
- Documentar com destaque a chave `NFSE_MASTER_KEY` e `SECRETS_ENCRYPTION_KEY`: perdê-las perde os certificados armazenados.
- Perfil de backup no compose (`--profile backup`): `pg_dump` agendado e retenção configurável, com instrução de restauração testada.
- Imagens já rodam sem root (`USER nestjs`, `USER nextjs`). **[em aberto]** avaliar `read_only`, `cap_drop` e `no-new-privileges` nos serviços; não foi verificado se o app escreve fora de volumes.
- O PR #47 (limites de recurso para 8 GB) e o PR #48 (Turnstile) valem aqui como defaults razoáveis. Adicionar um override `deploy/docker-compose.small.yml` para máquinas de 2 a 4 GB.

## 7. Subprojeto C: prontidão para tornar público

Checklist com critério de pronto cada item.

| Item | Critério |
|---|---|
| Dados pessoais | Nenhuma ocorrência de e-mail ou nome pessoais no código (`api/scripts/api-scenarios.mjs`, `test-api-key.mjs` usam `pedrook16@gmail.com`). `git grep` limpo. |
| Marca antiga | Substituir `greenflow` por `corvo` em `api/llms.txt`, nomes de tracing e Sentry, `GreenflowCookieKind`, prefixos `gf_*` e `gf:attest:`, chave `greenflow:human-proof`. **[decisão minha]** como a produção tem 1 tenant, aceitar a invalidação única de sessões; fazer na mesma janela do PR e avisar. Os testes que usam `custom_greenflow` só renomeiam. |
| Ativos externos | Logo do README e `stripe-branding.ts` deixam de apontar para `assets.greenflow.solutions`; o logo vai para o repositório. |
| Histórico | `gitleaks detect` no histórico completo passa sem achados antes de publicar; o histórico não contém arquivos internos. O `.gitignore` indica que o repositório veio de repositórios anteriores, então vale revisar também arquivos grandes. |
| Documentos internos | Decidir o destino de `docs/superpowers/` (planos e specs de agentes). **[em aberto]** manter, mover ou remover. Esta spec está nele. |
| `SECURITY.md` | Private Vulnerability Reporting do GitHub ativado e um contato real; remover o texto de "ainda sendo preparado". |
| Contribuição | `CONTRIBUTING.md` com **DCO** (`Signed-off-by`), templates de issue (bug e feature) e um `CHANGELOG`. **[decisão minha]** DCO em vez de CLA; ver seção 9. |
| Dependências | Verificação de licenças das dependências no CI, falhando se houver licença incompatível com AGPL. |
| Aviso legal | README e `SELF_HOSTING.md` com aviso: o software emite documento fiscal; a responsabilidade pela configuração, pelo certificado A1 e pelos dados é do operador; nota de LGPD. |
| Automação | Dependabot ou Renovate. |

## 8. Subprojeto D: distribuição e setup

### 8.1 Imagens

Workflow que, em cada tag `vX.Y.Z`, constrói e publica `corvo-api` e `corvo-web` no GHCR (multi-arquitetura), com tag fixa e `latest`. O `docker-compose.yml` passa a referenciar essas imagens, com `build:` mantido como alternativa para quem quiser compilar.

### 8.2 A calculadora RTC

É o ponto mais sensível. Hoje o build baixa o jar do governo por URL com WAF e confere o hash.

- **Não publicar** uma imagem com o jar até confirmar que os termos permitem redistribuição. **[em aberto]** nem verifiquei os termos.
- Até lá, o `rtc-calculator` continua sendo construído na máquina do operador, e o guia explica o tempo e a memória necessários.
- Se a redistribuição for permitida, publicar `corvo-rtc` com a tag `rtc-<app>-<db>` que o runbook já descreve.

### 8.3 Fluxo de setup alvo

```
git clone … && cd corvo-nfse
node scripts/setup-env.mjs --domain=exemplo.com   # gera segredos e escolhe o modo
docker compose up -d --wait                       # puxa imagens, migra, sobe
docker compose run --rm api node dist/scripts/create-admin.js
```

O que ainda depende do operador: um bucket S3 em produção (LocalStack no teste local), um certificado A1 por empresa e, opcionalmente, provedor de e-mail e Stripe (no modo `cloud`). **[em aberto]** avaliar armazenamento em disco ou MinIO no compose como alternativa ao S3 externo para instâncias pessoais.

`scripts/check-deploy-env.mjs` passa a validar também `DEPLOYMENT_MODE`, `ADMIN_EMAIL` e `AUTH_SIGNUP_MODE`.

### 8.4 Documentação

`SELF_HOSTING.md` ganha: início rápido de 5 passos, tabela dos três modos de exposição, upgrade, backup e restauração, rotação de chaves (o que quebra), dimensionamento por tamanho de máquina e solução de problemas do `create-admin`.

## 9. Licença

**AGPL-3.0 mantida [decidido].** Quem modificar o código e o oferecer em rede precisa abrir as modificações. O titular dos direitos (o dono) não é obrigado a abrir o que fizer na versão hospedada.

- **DCO [decisão minha].** Exige `Signed-off-by` nos commits. É leve e não transfere direitos. Se houver intenção real de oferecer licença comercial dupla no futuro, é preciso trocar por um CLA **antes** de aceitar contribuições externas. **[em aberto]**
- Acrescentar um `NOTICE` com as dependências e os trechos de terceiros relevantes, e uma nota no README sobre uso do nome e do logo "Corvo" (marca não é concedida pela AGPL).
- Verificar a compatibilidade das licenças das dependências (item da seção 7).

## 10. Testes e critérios de aceite

**A**
- Com `DEPLOYMENT_MODE=self_hosted` e sem nenhuma variável `STRIPE_*`, a API sobe.
- Um tenant novo emite mais de 3 notas no mesmo dia e cria mais de 1 empresa; nenhuma `credit_transaction` é gravada.
- `/v1/billing/*`, `/v1/credits/*` e `/v1/webhooks/stripe` respondem 404 `BILLING_DISABLED`.
- Em `cloud`, a suíte atual de billing e créditos passa sem alteração.
- `GET /` redireciona para `/app`; `/terms` responde 404; `/docs` responde 200 sem sessão; `robots.txt` bloqueia tudo.
- `/v1/config` não contém segredos e reflete o modo.

**B**
- Em `closed`, um e-mail desconhecido recebe a resposta normal de `magic-link/request`, mas nenhum e-mail é enviado e nenhum usuário é criado. O `ADMIN_EMAIL` consegue entrar.
- `create-admin` produz um link que funciona uma vez e expira; reutilizá-lo falha; em `cloud` o comando recusa.
- Convidado entra mesmo em `closed`.

**C**
- `git grep` por e-mails pessoais e `greenflow` não retorna nada fora de arquivos de histórico explicitamente permitidos.
- `gitleaks detect` no histórico completo sem achados.

**D**
- Em máquina limpa, o início rápido leva a um login e a uma nota emitida em ambiente de teste fiscal.
- Backup e restauração reproduzem o banco em outra máquina.

## 11. Riscos

- **Divergência entre modos.** Dois modos dobram a superfície de teste. Mitigação: a diferença fica em implementações trocadas por DI e cada uma tem sua suíte; um teste de contrato garante a mesma interface.
- **Renomeação de cookies e prefixos** invalida sessões e chaves de atestado em voo. Mitigação: janela única, produção com 1 tenant.
- **RTC.** Se a redistribuição não for permitida, o setup continua pesado. Mitigação: documentar claramente e manter a alternativa de build local.
- **Cadastro fechado mal configurado** deixa o operador sem acesso. Mitigação: `create-admin` sempre disponível por shell.
- **Expectativa fiscal.** O operador pode achar que o projeto garante conformidade. Mitigação: aviso legal explícito.

## 12. Em aberto (só o dono responde)

1. Destino de `docs/superpowers/` ao tornar o repositório público.
2. DCO ou CLA (depende de querer licença comercial dupla).
3. Termos de redistribuição do jar da RTC (precisa de leitura dos termos do governo).
4. Armazenamento local ou MinIO no compose para instâncias pessoais, em vez de S3 externo.
5. Endurecimento de containers (`read_only`, `cap_drop`) depende de verificar onde o app escreve.

## 13. Fora desta spec

Detalhes de implementação, nomes de arquivos novos e a divisão em tarefas ficam para o plano de cada subprojeto.
