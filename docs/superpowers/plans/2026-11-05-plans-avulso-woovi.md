# Planos Solo/Equipe/Empresa/Escala, Nota Avulsa e Pix (Woovi) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar o catálogo por quatro planos (mensal/anual), remover excedente, dar uma nota grátis por conta, vender notas avulsas e aceitar Pix (Woovi) além do cartão (Stripe).

**Architecture:** O gate de emissão continua em `BillingUsageService.reserve` + `BillingPeriod`. A cota do plano é consumida primeiro; quando acaba, consome-se o saldo avulso do ledger `credit_transactions`. `BillingProvider` ganha um segundo adaptador (Woovi) para cobranças Pix; Stripe segue para cartão. Anual é cobrança única de 12 x o mensal equivalente, com cota que reseta todo mês.

**Tech Stack:** NestJS + TypeORM + Postgres + Jest (api), Next.js + Vitest (web), Stripe, Woovi API (`https://api.woovi.com/api/v1`).

**Spec:** `docs/superpowers/specs/2026-11-05-plans-avulso-woovi-design.md`

## Global Constraints

- Slugs: `solo`, `equipe`, `empresa`, `escala`. Nomes de exibição: Solo, Equipe, Empresa, Escala. O slug `free` e os antigos (`developer`, `growth`, `scale`, `volume`) saem do catálogo ativo.
- Preços mensais em centavos: solo 5990, equipe 11990, empresa 23990, escala 39990.
- Preço anual por mês em centavos (30% off): solo 4190, equipe 8390, empresa 16790, escala 27990. Cobrança anual = 12 x esse valor (solo = 50280, equipe = 100680, empresa = 201480, escala = 335880).
- Notas por mês: solo 100, equipe 250, empresa 600, escala 1200.
- Homologação (ambiente de teste) é sempre grátis, sem plano e sem limite; notas de teste não consomem cota nem saldo.
- Quando a emissão é bloqueada por falta de cota e saldo, a resposta/tela oferece comprar notas avulsas.
- Avulso: 99 centavos por nota, mínimo 3 notas, notas não expiram.
- Primeira nota grátis: 1 por conta, uma vez, não renova.
- Sem excedente: nenhum medidor, invoice item ou teto de 5x. Esgotou cota e saldo = bloqueia.
- Consumo: cota do plano primeiro, saldo avulso depois.
- Carência de pagamento: 7 dias (`PAYMENT_GRACE_MS`, já existe). Troca de plano só na próxima renovação, sem proration.
- Pix avulso expira em 24h. App ID da Woovi só no backend (`Authorization: <APP_ID>`).
- Moeda BRL, valores em centavos. Textos em pt e en (`web/messages/pt.json`, `en.json`).
- Testes: `cd api && yarn test <path>`, `yarn typecheck`; `cd web && yarn test <path>`, `yarn typecheck`.

## Review Focus

- Webhook da Woovi repetido (mesmo `correlationID`/evento): não pode creditar nem ativar duas vezes (Task 5).
- Pagamento Pix que chega depois da expiração de 24h ou com valor diferente do cobrado: não deve creditar quantidade errada (Task 5).
- Duas emissões simultâneas com 1 nota restante (cota ou saldo): só uma passa (Task 3).
- Compra avulsa com 2 notas, 0 notas ou quantidade não inteira: rejeitada (Task 3).
- Cadastro com e-mail `a+1@x.com` e `a@x.com`: conta como a mesma pessoa e não ganha a nota grátis de novo (Task 4).

---

### Task 1: Catálogo novo (API) com preço anual

**Files:**
- Modify: `api/src/modules/plans/domain/plan.ts` (`PlanSlug`, `BillingCycle`)
- Modify: `api/src/modules/plans/application/pricing.service.ts`
- Modify: `api/src/modules/plans/application/plan-seeder.service.ts`
- Create: `api/src/infra/database/migrations/<timestamp>-NewPlanCatalog.ts`
- Test: `api/src/modules/plans/application/pricing.service.spec.ts`

**Interfaces:**
- Produces: `PlanSlug = 'solo' | 'equipe' | 'empresa' | 'escala'`; `BillingCycle = 'monthly' | 'annual'`.
- Produces: `PriceQuote { slug; name; monthlyAllowance; basePriceCents /*mensal cheio*/; monthlyEquivalentCents /*por mês no ciclo*/; chargeTotalCents /*cobrado de uma vez no ciclo*/; currency: 'BRL' }`. Remove `perCreditOverageCents` e `monthlyTotalCents`.
- Produces: `PricingService.calculateQuote(slug: PlanSlug, cycle: BillingCycle): PriceQuote`; `listAllQuotes(cycle): PriceQuote[]`.

- [ ] **Step 1: Write failing tests** em `pricing.service.spec.ts`: `calculateQuote('solo','monthly')` => `monthlyEquivalentCents 5990`, `chargeTotalCents 5990`; `('solo','annual')` => `monthlyEquivalentCents 4190`, `chargeTotalCents 50280`, `basePriceCents 5990`; para os 4 planos, `monthlyAllowance` = 100/250/600/1200; `listAllQuotes('annual')` tem 4 itens.
- [ ] **Step 2: Run** `cd api && yarn test src/modules/plans/application/pricing.service.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** a tabela `PRICING` com os valores de Global Constraints (campo `annualMonthlyCents` novo; sem `perCreditCents`), `calculateQuote` aceitando os dois ciclos. Atualizar `PlanSlug`/`BillingCycle` e corrigir os usos que o compilador apontar. `maxCompanies` 999999 e `support`: solo/equipe `email`, empresa/escala `priority`.
- [ ] **Step 4: Atualizar `SEED_DATA`** do `plan-seeder.service.ts` para os 4 slugs (allowance, throughput 50/100/200/500, `creditUnitPriceCents` 99).
- [ ] **Step 5: Migration** `NewPlanCatalog`: insere/atualiza as 4 linhas de `plans`, marca `active=false` nos slugs antigos (inclui `free`), e atualiza `billing_usage_periods.included` dos períodos abertos. Reversível (`down` reativa os antigos). Não apagar linhas (FK de tenants existentes).
- [ ] **Step 6: Run** `yarn test src/modules/plans && yarn typecheck` — Expected: PASS.
- [ ] **Step 7: Commit** `feat(plans): novo catálogo Solo/Equipe/Empresa/Escala com anual`.

### Task 2: Remover excedente

**Files:**
- Modify: `api/src/modules/billing/domain/billing-policy.ts`, `billing-period.ts`
- Delete: `api/src/modules/billing/application/overage-report.service.ts` (+ spec se houver); remover job em `billing/jobs/billing.scheduler.ts`
- Modify: `api/src/modules/billing/domain/billing-provider.port.ts` (remover `reportRoute`, `reportMeter`, `reportInvoiceItem`), `infra/external/stripe/stripe-billing.adapter.ts`
- Test: `billing/domain/billing-policy.spec.ts`, `billing-period.spec.ts`

**Interfaces:**
- Produces: `usageSummary(included: number, authorized: number, reserved: number): { included_remaining: number; hard_limit: number }` com `hard_limit = included`. Sem `unitCents`.
- Produces: `BillingPeriodState` sem `unitCents`, `reported`, `meterEventName`, `pendingReport`.

- [ ] **Step 1: Failing tests:** `usageSummary(100, 100, 0)` => `included_remaining 0, hard_limit 100`; `BillingPeriod.reserve` com `authorized+reserved >= included` lança `BillingRuleError('monthly_limit_exceeded')` mesmo em plano pago.
- [ ] **Step 2: Run** specs — FAIL.
- [ ] **Step 3: Implement:** remover `OVERAGE_MULTIPLIER`, campos de relatório e métodos do port/adapter; remover colunas via migration (`unit_cents`, `reported`, `meter_event_name`, `pending_report` em `billing_usage_periods`) — ou deixar nulas e marcar para limpeza futura (escolha do builder; preferir remover).
- [ ] **Step 4: Run** `yarn test src/modules/billing && yarn typecheck` — PASS.
- [ ] **Step 5: Commit** `refactor(billing): remove cobrança de excedente`.

### Task 3: Saldo avulso e gate de emissão

**Files:**
- Modify: `api/src/modules/credits/application/credits.service.ts`, `credits/http/credits.controller.ts`
- Modify: `api/src/modules/billing/application/billing-usage.service.ts`, `billing/domain/billing-period.ts`
- Test: `credits/application/credits.service.spec.ts`, `billing/application/billing-usage.service.spec.ts` (criar), `billing/domain/billing-period.spec.ts`

**Interfaces:**
- Produces: `export const AVULSO_UNIT_CENTS = 99; export const AVULSO_MIN_UNITS = 3;` em `credits/domain/avulso.ts`.
- Produces: `CreditsService.grantAvulso(tenantId: string, units: number, paymentRef: string): Promise<{ balance: number }>` — idempotente por `paymentRef` (mesma referência não credita duas vezes); lança se `units < 3` ou não inteiro.
- Produces: `CreditsService.consumeAvulso(tenantId: string, invoiceId: string): Promise<boolean>` — debita 1 nota do saldo de forma atômica; `false` se saldo 0.
- Produces: `BillingUsageService.reserve(tenantId): Promise<string>` passa a: usar cota do período se houver; senão `consumeAvulso`; senão lança `monthly_limit_exceeded`.
- Consumes: Task 2 (`usageSummary` sem excedente).

- [ ] **Step 1: Failing tests:** `grantAvulso(t, 2, 'p1')` lança; `grantAvulso(t, 3, 'p1')` duas vezes => saldo 3; reserva com cota 0 e saldo 2 => passa e saldo 1; cota 0 e saldo 0 => `monthly_limit_exceeded`; duas reservas concorrentes com saldo 1 => exatamente uma passa; cota > 0 => saldo avulso intacto.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** as assinaturas acima. Atomicidade do saldo via lock/UPDATE condicional no repositório de transações (builder escolhe, seguindo o padrão `repository.locked` de billing). Rejeição/falha/cancelamento de nota avulsa devolve a nota (reaproveitar `refundReservation`). Reativar `POST /credits/purchase` e `GET /credits/purchase/preview` no controller, hoje `GoneException`; o preview retorna `{ units, totalCents }` com `AVULSO_UNIT_CENTS`.
- [ ] **Step 4: Run** `yarn test src/modules/credits src/modules/billing && yarn typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(credits): saldo avulso a R$0,99 consumido após a cota do plano`.

### Task 4: Primeira nota grátis

**Files:**
- Modify: `api/src/modules/auth/application/passwordless-workspace.service.ts`
- Modify: `api/src/modules/plans/application/free-abuse-checker.service.ts`
- Create: `api/src/infra/database/migrations/<timestamp>-FirstFreeNote.ts`
- Test: `auth/application/passwordless-workspace.service.spec.ts`, `plans/application/free-abuse-checker.service.spec.ts`

**Interfaces:**
- Produces: coluna `tenants.free_note_granted_at timestamptz null`.
- Produces: `FreeAbuseChecker.isEligible(input: { email: string; taxId?: string | null }): Promise<boolean>` — normaliza e-mail (minúsculas, remove `+tag`, e pontos em gmail) e consulta tenants que já receberam a nota por e-mail normalizado ou CNPJ/CPF.
- Consumes: `CreditsService.grantBonus(tenantId, 1, 'Primeira nota grátis')`.

- [ ] **Step 1: Failing tests:** `ensureWorkspace` em e-mail novo => tenant sem plano e saldo 1; `a+1@x.com` depois de `a@x.com` => tenant criado, saldo 0; segunda chamada para o mesmo usuário => não concede de novo; tenant existente do free antigo, no primeiro login após a migration, sem nota emitida => saldo 1 (concedido uma vez).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** Cadastro não usa mais `free`: tenant nasce sem plano (builder define a representação, ex.: `plan_id` nulo/plano interno "sem plano" com cota 0). Concessão no primeiro login pós-verificação OTP, marcando `free_note_granted_at`. Remover a regra "Email already belongs to a free workspace".
- [ ] **Step 4: Run** `yarn test src/modules/auth src/modules/plans && yarn typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(auth): primeira nota grátis por conta com antiabuso`.

### Task 5: Provider Woovi (cobrança Pix única e Pix Automático)

**Files:**
- Create: `api/src/infra/external/woovi/woovi-billing.adapter.ts`, `woovi.client.ts`, `woovi-webhook.controller.ts`
- Create: `api/src/modules/billing/domain/payment-intent.ts` e migration da tabela `payment_intents`
- Modify: `api/src/modules/billing/domain/billing-provider.port.ts`, `infra/config/env.schema.ts`, `configuration.ts`, `api/.env.example`, `deploy/.env.example`
- Test: `woovi-billing.adapter.spec.ts`, `woovi-webhook.controller.spec.ts`

**Interfaces:**
- Produces: tabela `payment_intents(id uuid pk, tenant_id, kind 'plan'|'avulso', plan_slug null, cycle null, units null, amount_cents, provider 'woovi'|'stripe', provider_ref (correlationID), status 'pending'|'paid'|'expired', expires_at, paid_at null)` com unique em `(provider, provider_ref)`.
- Produces: `WooviBillingAdapter.createCharge(input: { correlationID: string; valueCents: number; comment: string; expiresInSeconds: number }): Promise<{ brCode: string; qrCodeImage: string; paymentLinkUrl: string }>` — `POST /charge` (cobrança dinâmica, não `/qrcode-static`).
- Produces: `WooviBillingAdapter.createRecurring(...)` para Pix Automático seguindo `developers.woovi.com/docs/woovi-prompts/pix-automatico`; assinatura exata a definir pelo builder lendo essa doc.
- Produces: `POST /v1/webhooks/woovi` — valida assinatura (reaproveitar a lógica de `integrations/connectors/woovi/woovi-public-key.provider.ts` como referência), deduplica por `provider_ref`, e ao pagar: `kind 'avulso'` => `CreditsService.grantAvulso(tenantId, units, provider_ref)`; `kind 'plan'` => ativa o plano até o fim do ciclo (mensal: +1 mês; anual: +12 meses, cota resetando todo mês).
- Env novos: `WOOVI_APP_ID`, `WOOVI_WEBHOOK_SECRET` (ou chave pública), `WOOVI_API_URL` (default `https://api.woovi.com/api/v1`). `PAYMENT_ALLOWED_PROVIDERS` aceita `stripe` e `woovi`; `check-deploy-env.mjs` exige as vars da Woovi quando `woovi` está permitido.

- [ ] **Step 1: Failing tests:** adapter envia `Authorization: <APP_ID>`, `value` em centavos e `correlationID`; webhook de pagamento duas vezes => um único crédito; pagamento depois do `expires_at` => marca `expired`, não credita; valor pago diferente de `amount_cents` => não credita e loga alerta; assinatura inválida => 401.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** adapter, controller, tabela e env. Cobrança expira em 24h (`expiresInSeconds: 86400`). Pix Automático só para plano mensal; anual e avulso usam cobrança única.
- [ ] **Step 4: Run** `yarn test src/infra/external/woovi src/modules/billing && yarn typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(billing): provider Woovi para Pix único e Pix Automático`.

### Task 6: Checkout unificado (plano/avulso x Pix/cartão)

**Files:**
- Modify: `api/src/modules/billing/billing.controller.ts`, `http/billing.dto.ts`, `application/billing.service.ts`
- Modify: `api/src/infra/external/stripe/stripe-billing.adapter.ts`, `api/scripts/provision-stripe.ts`
- Test: `billing/application/billing.service.checkout.spec.ts` (criar)

**Interfaces:**
- Produces: `POST /billing/checkout` body `{ kind: 'plan'|'avulso'; planSlug?: PlanSlug; cycle?: 'monthly'|'annual'; units?: number; method: 'pix'|'card' }` (header `Idempotency-Key` obrigatório, como hoje). Retorna `{ method:'card', url }` (Stripe) ou `{ method:'pix', brCode, qrCodeImage, paymentLinkUrl, expiresAt }` (Woovi).
- Regras: `kind 'plan'` + `cycle 'annual'` + `card` => Stripe pagamento único de `chargeTotalCents` (ou assinatura anual — builder escolhe a mais simples), `kind 'avulso'` + `card` => Stripe pagamento único `units * 99`; `pix` sempre Woovi. Cada checkout cria um `payment_intents`.
- Stripe: `provision-stripe.ts` cria preços `corvo_<slug>_monthly` (e `_annual` se usar assinatura anual) para os 4 slugs, sem preços metered, e desativa os antigos. Rodar o script é passo manual do operador.

- [ ] **Step 1: Failing tests:** avulso com 2 unidades => 400; avulso 10 unidades Pix => `createCharge` com `valueCents 990`; plano anual Pix solo => `valueCents 50280`; mesmo `Idempotency-Key` duas vezes => mesma cobrança; plano mensal Pix => usa Pix Automático.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** roteamento por `method` e `kind`, aplicando o plano apenas quando o pagamento confirmar (webhook Stripe existente para cartão; Task 5 para Pix). Troca de plano agenda para a próxima renovação (já existe `changePlan`).
- [ ] **Step 4: Run** `yarn test src/modules/billing && yarn typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(billing): checkout unificado plano/avulso com Pix e cartão`.

### Task 7: Calculadora "preciso de N notas"

**Files:**
- Modify: `api/src/modules/plans/application/pricing.service.ts`, `plans/http/plan.controller.ts`
- Test: `pricing.service.spec.ts`

**Interfaces:**
- Produces: `PricingService.recommendForNotes(notesPerMonth: number, cycle: BillingCycle): { option: { planSlug: PlanSlug | null; avulsoUnits: number; totalCents: number }; alternatives: Array<same> }`. Compara cada plano que cobre N e "plano menor + avulso para o restante" (N - cota); avulso a 99 centavos; retorna a mais barata por mês-equivalente. `GET /plans/recommend?notes=250&cycle=monthly`.
- Substitui `recommendPlanForVolume`.

- [ ] **Step 1: Failing tests:** `recommendForNotes(250,'monthly')` => `planSlug 'equipe'`, `avulsoUnits 0`, `totalCents 11990` (solo+150 avulsas = 20840 é mais caro); `recommendForNotes(110,'monthly')` => `solo` + 10 avulsas = 6980; `recommendForNotes(0,...)` e valores negativos => 400.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** e expor o endpoint.
- [ ] **Step 4: Run** `yarn test src/modules/plans && yarn typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(plans): calculadora de notas`.

### Task 8: Web — preços, checkout e calculadora

**Files:**
- Modify: `web/lib/plans-catalog.ts`, `web/tests/helpers/pricing-catalog.ts`, `web/lib/pricing-jsonld.ts`, `web/lib/types.ts` (remover `annualTotalCents`), `web/lib/api.ts`
- Modify: `web/components/pricing/plan-picker.tsx`, `web/components/landing/pricing.tsx`, `web/components/landing/credits-explained.tsx`, `web/app/(dashboard)/app/billing/page.tsx`
- Create: `web/components/pricing/notes-calculator.tsx`, `web/components/billing/checkout-dialog.tsx`
- Modify: `web/messages/pt.json`, `web/messages/en.json`
- Test: `web/tests/plan-picker.test.ts`, `web/tests/notes-calculator.test.tsx`, `web/tests/checkout-dialog.test.tsx`

**Interfaces:**
- Consumes: `GET /plans`, `GET /plans/recommend`, `POST /billing/checkout`, `GET /credits/purchase/preview` (Tasks 1, 3, 6, 7).
- Produces: `PLANS` com os 4 planos e `annualMonthlyCents`; seletor mensal/anual.

- [ ] **Step 1: Failing tests:** no anual, o card Solo mostra `R$ 41,90/mês`, o `R$ 59,90` riscado (`<s>`/`line-through`) e o texto `R$ 502,80` cobrados uma vez; no mensal não há riscado; calculadora com 250 recomenda Equipe; diálogo de checkout com Pix mostra QR e `brCode` copiável, com cartão redireciona para a URL; avulso abaixo de 3 desabilita o botão.
- [ ] **Step 2: Run** `cd web && yarn test` nos arquivos — FAIL.
- [ ] **Step 3: Implement** os componentes e textos pt/en. Dashboard e página pública usam a mesma apresentação do anual. Remover referências a excedente e ao free de 15/mês nos textos e no JSON-LD.
- [ ] **Step 4: Run** `yarn test && yarn typecheck && yarn lint` — PASS.
- [ ] **Step 5: Commit** `feat(web): novos planos, checkout Pix/cartão e calculadora`.

### Task 9: Fechamento (docs e verificação)

**Files:**
- Modify: `docs/` onde citar planos/excedente (buscar por `developer`, `growth`, `excedente`, `overage`), `README` se houver tabela de preços
- Modify: `api/.env.example`, `deploy/.env.example`

- [ ] **Step 1:** `grep -rn "overage\|excedente\|developer\b\|growth\b" docs api/src web --include=*.ts --include=*.tsx --include=*.md --include=*.json` e corrigir sobras.
- [ ] **Step 2:** `cd api && yarn typecheck && yarn typecheck:tests && yarn test` e `cd web && yarn typecheck && yarn lint && yarn test` — PASS.
- [ ] **Step 3:** Checklist manual para o operador (não automatizar): rodar `provision-stripe.ts`, preencher `WOOVI_APP_ID` e segredo do webhook, cadastrar a URL `/v1/webhooks/woovi` no painel Woovi, rodar a migration.
- [ ] **Step 4: Commit** `docs: atualizar planos e variáveis de ambiente`.
