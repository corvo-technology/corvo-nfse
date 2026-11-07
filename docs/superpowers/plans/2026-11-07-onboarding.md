# Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um cartão "Bem-vindo ao Corvo" no painel guia quem acabou de criar a conta até a primeira nota de teste, tudo opcional, com uma faixa explicativa na página da nota.

**Architecture:** Só web, nenhuma tabela nem endpoint novo. O progresso dos passos é calculado a partir de dados reais (empresa, certificado, contador de DPS, notas). O que é só preferência (cartão oculto, planos vistos, "nunca emiti", faixa dispensada) fica em `localStorage` por conta e workspace. Cada passo abre uma janela (`Modal`) com componentes que já existem; o passo da nota navega até `/app/invoices/new`.

**Tech Stack:** Next.js (app router), React, `next-intl` (pt/en), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-07-onboarding-design.md`

**Base:** o passo 4 usa `DpsSequenceCard` (`web/components/companies/dps-sequence-card.tsx`) e `companies.dpsSequence` do PR #129. Começar a partir da `main` depois que #129 for mergeado, ou empilhar a branch sobre `feat/dps-start-number`.

## Global Constraints

- Todo texto novo em `web/messages/pt.json` e `web/messages/en.json`, no namespace `Onboarding`, com as mesmas chaves nos dois (há teste de paridade).
- Reaproveitar `Modal`, `Card`, `Button`, `CompanyForm`, `CertificateUpload`, `DpsSequenceCard`. Não duplicar formulário nem extrair o formulário de nota.
- Erros da API sempre por `useApiErrorText()`. Nunca texto cru em inglês.
- Dizer "sem consumir créditos", nunca "ilimitado".
- Acesso a `localStorage` sempre dentro de `try/catch`; a tela funciona sem ele.
- O cartão só aparece com `fiscalEnvironment === "test"`.
- Permissões por passo: empresa `nfse.companies.manage`, certificado `nfse.certificates.manage`, nota `nfse.invoices.issue`. O passo 1 (planos) e o 4 (numeração) seguem `nfse.companies.manage`.
- Testes no padrão de `web/tests/schedule-panel.test.tsx`: `// @vitest-environment jsdom`, `vi.mock("@/lib/api")`, `vi.mock("@/lib/auth")`, `NextIntlClientProvider locale="en"`.

## Review Focus

- Falha de `localStorage` (modo privado) não pode quebrar o painel: o cartão aparece e funciona, só não lembra o que foi dispensado.
- Falha em uma consulta (certificado, contador, notas) não pode esconder o cartão nem travar os outros passos: o passo afetado fica como "não feito".
- Workspace com várias empresas: os passos 3, 4 e 5 usam a mais antiga do ambiente.
- Pessoa sem nenhuma das permissões dos passos: o cartão não aparece, sem erro.
- Trocar de ambiente com o cartão aberto: em `live` ele some; voltar para `test` mostra o estado correto.

---

### Task 1: Preferências no navegador

**Files:**
- Create: `web/lib/onboarding-flags.ts`
- Test: `web/tests/onboarding-flags.test.ts`

**Interfaces:**
- Produces:
  - `type OnboardingFlag = "hidden" | "plansSeen" | "noPriorNotes" | "noteBannerDismissed"`
  - `readFlag(tenantId: string, flag: OnboardingFlag): boolean`
  - `writeFlag(tenantId: string, flag: OnboardingFlag): void`

- [ ] **Step 1: Write the failing test** (`onboarding-flags.test.ts`, `// @vitest-environment jsdom`)
  - `writeFlag("t1","hidden")` então `readFlag("t1","hidden")` é `true`; `readFlag("t2","hidden")` e `readFlag("t1","plansSeen")` são `false`.
  - Com `Storage.prototype.getItem` e `setItem` lançando erro: `readFlag` retorna `false` e `writeFlag` não lança.
- [ ] **Step 2: Run** `cd web && npx vitest run tests/onboarding-flags.test.ts`. Expected: FAIL (módulo não existe).
- [ ] **Step 3: Implement** `onboarding-flags.ts`: chave `corvo:onboarding:${tenantId}:${flag}`, valor `"1"`, tudo em `try/catch`.
- [ ] **Step 4: Run** o mesmo comando. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): preferências do onboarding no navegador`.

---

### Task 2: Regras dos passos (função pura)

**Files:**
- Create: `web/lib/onboarding-steps.ts`
- Test: `web/tests/onboarding-steps.test.ts`

**Interfaces:**
- Consumes: `OnboardingFlag` (Task 1).
- Produces:
  - `type StepKey = "plans" | "company" | "certificate" | "numbering" | "note"`
  - `interface OnboardingInput { can: (permission: string) => boolean; hasCompany: boolean; hasCertificate: boolean; lastDpsNumber: number; hasTestNote: boolean; flags: Record<OnboardingFlag, boolean> }`
  - `interface OnboardingStep { key: StepKey; done: boolean; locked: boolean }`
  - `buildSteps(input: OnboardingInput): OnboardingStep[]` retorna só os passos visíveis, na ordem acima.

- [ ] **Step 1: Write the failing tests**
  - Tudo vazio e todas as permissões: 5 passos, nenhum `done`; `note` com `locked: true`.
  - `plans.done` ⇔ `flags.plansSeen`; `company.done` ⇔ `hasCompany`; `certificate.done` ⇔ `hasCertificate`; `numbering.done` ⇔ `lastDpsNumber > 0 || flags.noPriorNotes`; `note.done` ⇔ `hasTestNote`.
  - `note.locked` é `false` só com `hasCompany && hasCertificate`.
  - Sem `nfse.certificates.manage`, o passo `certificate` não aparece. Sem `nfse.invoices.issue`, `note` não aparece. Sem nenhuma das três permissões, a lista é vazia.
  - `numbering` e `plans` seguem `nfse.companies.manage`.
- [ ] **Step 2: Run** `npx vitest run tests/onboarding-steps.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `buildSteps` conforme a tabela da spec.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): regras dos passos do onboarding`.

---

### Task 3: Carregar o estado real (hook)

**Files:**
- Create: `web/lib/use-onboarding.ts`
- Test: `web/tests/use-onboarding.test.tsx`

**Interfaces:**
- Consumes: `buildSteps`, `readFlag`/`writeFlag`, `companies.list`, `certificates.list(companyId, params)`, `companies.dpsSequence(companyId)`, `invoices.list({ limit: 1 })`, `useAuth()` (`can`, `tenantId`, `fiscalEnvironment`).
- Produces: `useOnboarding(): { visible: boolean; loading: boolean; steps: OnboardingStep[]; firstCompanyId: string | null; done: number; total: number; allDone: boolean; hide(): void; mark(flag: "plansSeen" | "noPriorNotes"): void; reload(): void }`

- [ ] **Step 1: Write the failing tests** (mock `@/lib/api` e `@/lib/auth`)
  - Com `fiscalEnvironment: "live"`: `visible` é `false` e nenhuma API é chamada.
  - Empresas `[]`: `hasCompany` falso, e `certificates`, `dpsSequence` e `invoices` não são chamados.
  - Duas empresas: consulta certificado e contador da **primeira** (a mais antiga: ordenar por `createdAt` crescente antes de escolher).
  - Se `certificates.list` rejeitar: o passo `certificate` fica não feito e os demais continuam corretos.
  - `hide()` grava a flag e `visible` vira `false`; `mark("plansSeen")` marca o passo `plans` como feito.
  - Sem passos visíveis (sem permissões): `visible` é `false`.
- [ ] **Step 2: Run** `npx vitest run tests/use-onboarding.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** o hook: carrega em `useEffect` com `AbortController`, reinicia ao mudar `tenantId`, `fiscalEnvironment` ou `reload()`. Cada consulta secundária com `.catch(() => <valor neutro>)`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): hook que calcula o progresso do onboarding`.

---

### Task 4: Janela de planos

**Files:**
- Create: `web/components/onboarding/plans-dialog.tsx`
- Modify: `web/messages/pt.json`, `web/messages/en.json` (namespace `Onboarding`)
- Test: `web/tests/onboarding-plans-dialog.test.tsx`

**Interfaces:**
- Consumes: `plans.list("monthly")` (retorna `Page<PlanQuote>` com `slug`, `name`, `monthlyAllowance`, `monthlyEquivalentCents`).
- Produces: `PlansDialog({ open, onClose }: { open: boolean; onClose(): void })`.

- [ ] **Step 1: Write the failing tests**
  - Ao abrir, chama `plans.list` e mostra cada plano com nome, preço em R$ (centavos formatados) e quantidade de notas por mês.
  - Mostra as 3 frases de boas-vindas (chaves `Onboarding.intro.*`) e a frase sobre testes: "Em ambiente de teste você emite quantas notas quiser, sem consumir créditos."
  - Se `plans.list` falhar: mostra só as frases, sem erro vermelho e sem planos.
  - Não tem botão de pagamento.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** o componente com `Modal`; textos pt/en em `Onboarding.intro.*` e `Onboarding.plans.*`.
- [ ] **Step 4: Run** e também `npx vitest run tests/messages` (ou o teste de paridade existente). Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): janela de boas-vindas e planos do onboarding`.

---

### Task 5: O cartão e as janelas dos passos

**Files:**
- Create: `web/components/onboarding/onboarding-card.tsx`
- Modify: `web/messages/pt.json`, `web/messages/en.json` (`Onboarding.card.*`, `Onboarding.steps.*`)
- Test: `web/tests/onboarding-card.test.tsx`

**Interfaces:**
- Consumes: `useOnboarding()`, `PlansDialog`, `CompanyForm` (props `onSave`, `onCancel`, `onFinish`; copiar o `onSave` de `app/(dashboard)/app/companies/page.tsx:121`, que chama `companies.create`), `CertificateUpload({ companyId, onUploaded })`, `DpsSequenceCard({ companyId, canManage })`, `next/link`.
- Produces: `OnboardingCard()` sem props.

- [ ] **Step 1: Write the failing tests**
  - Não renderiza nada quando `visible` é `false`.
  - Mostra o contador "0 de 5" e cada passo; passo feito aparece marcado; "Ocultar" chama `hide()`.
  - Clicar em "Cadastre sua empresa" abre a janela do `CompanyForm`; ao terminar, fecha e chama `reload()`.
  - Clicar em "Envie o certificado" abre `CertificateUpload` da `firstCompanyId`; ao enviar, fecha e chama `reload()`.
  - Clicar em "Informe a última nota" abre `DpsSequenceCard`; o link "Nunca emiti notas antes" chama `mark("noPriorNotes")`.
  - Abrir "Conheça o Corvo" chama `mark("plansSeen")` e abre `PlansDialog`.
  - Passo `note` bloqueado mostra "Cadastre a empresa e envie o certificado para liberar" e não é clicável; desbloqueado é um link para `/app/invoices/new`.
  - Com `allDone`: mostra "Tudo pronto" em vez da lista, com o aviso do seletor de ambiente.
- [ ] **Step 2: Run** `npx vitest run tests/onboarding-card.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** o cartão usando `Card`, `Button` e `Modal`; um `useState<StepKey | null>` para a janela aberta.
- [ ] **Step 4: Run** com o teste de paridade de mensagens. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): cartão de boas-vindas com os passos do onboarding`.

---

### Task 6: Colocar o cartão no painel

**Files:**
- Modify: `web/app/(dashboard)/app/page.tsx` (renderizar `<OnboardingCard />` no topo, abaixo do `PageHeader`)
- Test: `web/tests/overview-onboarding.test.tsx` (ou acrescentar ao teste existente do painel, se houver)

**Interfaces:**
- Consumes: `OnboardingCard` (Task 5).

- [ ] **Step 1: Write the failing test:** o painel renderiza o cartão em `test` para quem gerencia empresas, e não renderiza em `live`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** a inclusão.
- [ ] **Step 4: Run** `npx vitest run tests/overview-onboarding.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): mostrar o onboarding no painel`.

---

### Task 7: Faixa na página da nota e destaque do seletor de ambiente

**Files:**
- Create: `web/components/onboarding/first-note-banner.tsx`
- Modify: `web/app/(dashboard)/app/invoices/[id]/page.tsx` (renderizar a faixa), `web/components/dashboard/env-switch.tsx` e `web/components/dashboard/topbar.tsx` (destaque), `web/messages/{pt,en}.json` (`Onboarding.note.*`)
- Test: `web/tests/first-note-banner.test.tsx`

**Interfaces:**
- Consumes: `invoices.list({ limit })`, `readFlag`/`writeFlag`, `useAuth()`.
- Produces: `FirstNoteBanner({ invoiceId }: { invoiceId: string })`. O destaque usa o evento do `window` `onboarding-highlight-env` (mesmo padrão do `fiscal-environment-change` já usado no `topbar`), ouvido pelo `Topbar`, que passa `highlight` ao `EnvSwitch`; o destaque some sozinho depois de alguns segundos.

- [ ] **Step 1: Write the failing tests**
  - Em `test`, na primeira nota de teste da conta (o `invoiceId` é a nota mais antiga do ambiente): mostra os 3 blocos (status, PDF e XML, ambiente) e a frase "não consome créditos"; dispara `onboarding-highlight-env` uma vez.
  - Numa nota que não é a primeira: não renderiza.
  - Depois de "Entendi" (grava `noteBannerDismissed`): não renderiza mais.
  - Em `live`: não renderiza.
  - `invoices.list` falha: não renderiza, sem erro.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** a faixa. Verificar a ordenação de `GET /invoices` (o mais novo primeiro ou não) e escolher a consulta mais barata que identifique a mais antiga; se não houver como, aceitar "a conta tem uma única nota" como critério e anotar a decisão no commit.
- [ ] **Step 4: Run** `npx vitest run tests/first-note-banner.test.tsx` e os testes existentes de topbar e página de nota. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): faixa explicativa na primeira nota de teste e destaque do ambiente`.

---

### Task 8: Verificação final

- [ ] **Step 1:** `cd web && npx tsc --noEmit && npx eslint components/onboarding lib/onboarding-*.ts lib/use-onboarding.ts "app/(dashboard)/app" `. Expected: sem erros novos.
- [ ] **Step 2:** `npx vitest run`. Expected: só as 30 falhas conhecidas de `tests/docs-integrations.test.ts`.
- [ ] **Step 3:** Abrir `/app` em `test` com uma conta nova (sem empresa): ver o cartão, abrir a janela de planos, cadastrar empresa, ver o contador subir, ocultar. Conferir também em `live`: cartão ausente.
- [ ] **Step 4:** Abrir o PR com a descrição apontando a spec e o que ficou de fora.
