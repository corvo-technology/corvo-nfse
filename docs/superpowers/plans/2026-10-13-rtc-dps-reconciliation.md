# Calculadora RTC real, DpsBuilder e conciliação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar o `UnconfiguredRtcCalculator` por um adapter HTTP da Calculadora RTC oficial (rede privada), montar a DPS completa (incluindo o grupo `IBSCBS`) a partir do snapshot fiscal, emiti-la preservando numeração/idempotência/retry, e conciliar o que a engine calculou com a NFS-e autorizada sem alterar o XML.

**Architecture:** `HttpRtcCalculatorAdapter` implementa o `RtcCalculatorPort` do plano 2 contra o contrato **já verificado** (`docs/fiscal/rtc/`, app `1.6.0`, dados `V0059`): primeiro a base da NFS-e (`nfse/base-calculo`), depois o cálculo (`regime-geral`). A Calculadora oficial roda como serviço interno (jar + Java 21, imagem própria). Os catálogos NBS/CST/cClassTrib/cIndOp são validados por consulta ao motor com a data da competência. `DpsBuilder` (domínio puro + tipos do `open-nfse`) converte `FiscalCalculationResult` em `DPS`; o `OpenNfseProvider` assina a DPS pronta via `emitirDpsPronta(dps, { dryRun: true })` e segue o fluxo atual (pending → `replayPendingEvents`). Após `authorized`, um job BullMQ `nfse-fiscal-reconcile` compara os valores do XML autorizado com o snapshot e grava `invoice_fiscal_reconciliations`.

**Tech Stack:** NestJS 11, TypeORM/PostgreSQL (RLS), BullMQ, `open-nfse` 0.11.0 (layout RTC v1.01), Jest (unit com SDK real via bridge nativo), Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-13-rtc-dps-reconciliation-design.md` (depende dos planos `outbox-intake-schedule` e `fiscal-engine-core` já executados).

## Global Constraints

- Trabalhar em `api/` e `deploy/`; branch `feat/rtc-dps-reconciliation` (nunca na `main`).
- Caminhos com prefixo `api/`, `docs/` ou `deploy/` são relativos à **raiz do repositório**; todos os demais (`src/`, `test/`, `scripts/`, `nest-cli.json`) são relativos a `api/`. Comandos `yarn` rodam em `api/`.
- **Contrato da Calculadora verificado em 2026-10-15** (`docs/fiscal/rtc/README.md`, `openapi.json`, fixtures reais). Use somente os endpoints listados lá; se `GET …/versao` mudar, recapture as fixtures antes de seguir. A API pública do governo tem WAF e **nunca** é dependência de produção nem de CI intensivo. A Corvo **nunca** envia `aliquotasNominais` e rejeita `calculoSimulado: true` (sem alíquota estimada).
- Sem `any`; falhas esperadas são `Result<_, FiscalError>`; erros de SDK/HTTP nunca saem do adapter.
- Layout ativo por ambiente: `FISCAL_DPS_LAYOUT` (padrão `rtc-v1.01`). Layout publicado mas não implantado e NT 009/V1.04.00 ⇒ `DPS_LAYOUT_UNSUPPORTED`. Nada de XML presumido, nada de editar `node_modules`, XSD nunca ignorado (`skipValidation` proibido).
- Timeout após transmissão ⇒ resultado indeterminado: consultar (`fetchDpsStatus`/`fetchByChave`) antes de qualquer reenvio; nunca reservar nova numeração para a mesma invoice.
- Certificado A1, PFX e senha nunca em log/telemetria; XML completo nunca em log.
- Unit tests rodam com `open-nfse` mapeado para `test/__mocks__/open-nfse.ts` (que **re-exporta o SDK real** de um subconjunto de símbolos). Todo símbolo novo usado em unit tests deve ser acrescentado a esse mock. Testes de emissão com `NfseClientFake` real rodam em `jest-fiscal.json`.
- Nenhuma emissão em produção em testes. Produção Restrita só manual/opcional com credenciais, e só o que for efetivamente executado vira "homologado" em `docs/fiscal/homologation.md`.
- Migrations após `1791810000000`; RLS idêntica às existentes; novas tabelas em `TENANT_RLS_TABLES`.

## Review Focus

- RTC fora do ar / lento / 5xx ⇒ erro retryable e **nenhuma** DPS emitida sem o grupo exigido (Task 2, 6).
- Competência de 2027 em diante: o motor exige alíquotas nominais que a base dele ainda não tem ⇒ `TAX_RATE_NOT_FOUND` bloqueante, sem estimar (Task 3).
- `calculoSimulado: true` nunca é aceito como valor fiscal (Task 3).
- Base de IBS/CBS ≠ valor bruto (ISS e desconto saem da base): sempre `nfse/base-calculo` antes do cálculo (Task 3).
- Calculadora ainda em partida (~4 min) ou reiniciando não rejeita a invoice: erro retryable (Task 2).
- Validação de catálogo usa a data da competência, não a de hoje (Task 4).
- Resposta do motor com tipos errados, campos ausentes ou valores negativos ⇒ erro de cálculo não retryable, nunca valor presumido (Task 3).
- Timeout durante o POST: a mesma invoice nunca ganha segunda numeração nem segunda DPS (Task 7).
- 429 com `Retry-After` respeitado (Task 7).
- DPS sem tomador, com desconto, com ISS retido, com CNPJ alfanumérico (Task 5).
- Layout não implantado/NT 009 bloqueia com erro explícito antes de assinar (Task 6).
- Divergência de 1 centavo (arredondamento) não vira alarme; divergência material sim; XML autorizado intacto (Task 8).
- Nota autorizada sem grupo IBS/CBS (tolerância da Sefin) é registrada como `missing_in_authorized`, não como "ok" (Task 8).
- Reconciliação duplicada (job reentregue) não cria segunda linha (Task 8).

---

## Task 1: Implantação interna da Calculadora e contrato verificado

O contrato **já foi descoberto e capturado** em 2026-10-15 (app `1.6.0`, dados `V0059`); os artefatos estão em `docs/fiscal/rtc/` (`README.md`, `openapi.json`, `ZIP_SHA256.txt`, `fixtures/*.json`). Esta task implanta o serviço e a configuração.

**Files:**
- Create: `deploy/Dockerfile.rtc`, `deploy/rtc-pinned-version.txt`, `scripts/rtc-smoke.sh`
- Modify: `deploy/docker-compose.yml`, `deploy/docker-compose.local.yml`, `deploy/README.md`, `api/.env.example`
- Modify: `src/infra/config/env.schema.ts`, `configuration.ts`, `configuration.types.ts`
- Test: `src/infra/config/rtc-env.spec.ts`

- [ ] **Step 1: Conferir os artefatos e a versão.** `ls docs/fiscal/rtc docs/fiscal/rtc/fixtures` deve listar `README.md`, `openapi.json`, `ZIP_SHA256.txt` e 6 fixtures. Compare com o pacote oficial **uma vez** (o site público tem WAF; não faça rajadas): `curl -s 'https://piloto-cbs.tributos.gov.br/servico/calculadora-consumo/api/calculadora/download/url?platform=jar'` devolve `downloadUrl`; baixe, rode `shasum -a 256` e compare com `ZIP_SHA256.txt`. Se diferir, o governo publicou versão nova: suba a versão nova (Step 3), recapture as fixtures conforme o README e revise o diff antes de seguir.

- [ ] **Step 2: `deploy/Dockerfile.rtc`** (imagem própria; não existe imagem oficial confirmada):
```dockerfile
FROM eclipse-temurin:21-jre
ARG RTC_ZIP_URL
ARG RTC_ZIP_SHA256
RUN apt-get update \
 && apt-get install -y --no-install-recommends unzip curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN curl -fsSL "$RTC_ZIP_URL" -o /tmp/rtc.zip \
 && echo "$RTC_ZIP_SHA256  /tmp/rtc.zip" | sha256sum -c - \
 && unzip -q /tmp/rtc.zip -d /app \
 && rm -f /tmp/rtc.zip /app/codigo-fonte-backend.zip \
 && useradd -r -u 10001 rtc && chown -R rtc /app
USER rtc
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "api-regime-geral.jar", "--spring.profiles.active=offline"]
```
O build **falha de propósito** se o arquivo publicado mudar (SHA-256 diferente): atualizar a Calculadora é uma decisão explícita. Como o governo substitui o arquivo no mesmo endereço, builds antigos deixam de ser reproduzíveis: publique a imagem construída no registry com a tag `rtc-<versaoApp>-<versaoDb>` (ex.: `rtc-1.6.0-V0059`) e faça o deploy sempre pela imagem, não pelo build.

- [ ] **Step 3: Compose** — serviço interno, **sem `ports`**, só na rede do compose:
```yaml
  rtc-calculator:
    image: ${RTC_IMAGE:-corvo-rtc:local}
    build:
      context: ../
      dockerfile: deploy/Dockerfile.rtc
      args:
        RTC_ZIP_URL: ${RTC_ZIP_URL:?Informe RTC_ZIP_URL (veja deploy/README.md)}
        RTC_ZIP_SHA256: ${RTC_ZIP_SHA256:?Informe RTC_ZIP_SHA256}
    init: true
    restart: unless-stopped
    mem_limit: 1536m
    healthcheck:
      test: ['CMD-SHELL', 'curl -fsS http://localhost:8080/api/calculadora/dados-abertos/versao || exit 1']
      interval: 15s
      timeout: 5s
      retries: 10
      start_period: 420s
```
Medições (2026-10-15): partida ~254 s, ~714 MiB em regime, 25–440 ms por cálculo. Em `x-backend` acrescente `RTC_CALCULATOR_URL: http://rtc-calculator:8080/api` e `depends_on: rtc-calculator: { condition: service_healthy }` para `api` e `worker` (o worker não deve aceitar jobs fiscais antes da Calculadora subir). Espelhe no `docker-compose.local.yml`. Documente em `deploy/README.md` como obter `RTC_ZIP_URL` (endpoint `download/url?platform=jar`) e `RTC_ZIP_SHA256` (`docs/fiscal/rtc/ZIP_SHA256.txt`), e grave `1.6.0/V0059` em `deploy/rtc-pinned-version.txt`.

- [ ] **Step 4: Configuração.** `env.schema.ts` (zod): `RTC_CALCULATOR_URL` (url, opcional), `RTC_CALCULATOR_TIMEOUT_MS` (padrão 8000), `RTC_CALCULATOR_MAX_CONCURRENCY` (padrão 8), `RTC_CIRCUIT_FAILURE_THRESHOLD` (padrão 5), `RTC_CIRCUIT_RESET_MS` (padrão 30000), `FISCAL_DPS_LAYOUT` (enum `rtc-v1.01`, padrão `rtc-v1.01`); `configuration.ts`/`types`: seção `rtc` com `{ url?, timeoutMs, maxConcurrency, circuitFailureThreshold, circuitResetMs, dpsLayout }`; `api/.env.example` com os valores. Teste `rtc-env.spec.ts` no padrão do `outbox-env.spec.ts` (defaults e coerção).

- [ ] **Step 5: Smoke script** `scripts/rtc-smoke.sh` (usa só a instância interna): imprime `GET …/versao`, chama `POST …/nfse/base-calculo` e `POST …/regime-geral` com o corpo de `docs/fiscal/rtc/fixtures/ok-consultoria-2026.json` (`steps[0].request`) e falha se `vCBS` ≠ `9.00` ou `vIBS` ≠ `1.00`. Rode contra o serviço local: `RTC_URL=http://localhost:18080/api scripts/rtc-smoke.sh`.

- [ ] **Step 6: Run + commit** — `yarn jest src/infra/config && yarn typecheck && docker compose -f ../deploy/docker-compose.yml config --quiet` (com as variáveis exigidas). `git add -A deploy api docs/fiscal && git commit -m "chore(rtc): deploy the official calculator as a private service"`.

---

## Task 2: HttpRtcCalculatorAdapter — transporte, erros, resiliência

**Files:**
- Create: `src/modules/invoice/infra/fiscal/rtc/http-rtc-calculator.adapter.ts`
- Create: `src/modules/invoice/infra/fiscal/rtc/rtc-http-client.ts`
- Create: `src/modules/invoice/infra/fiscal/rtc/circuit-breaker.ts`
- Create: `src/modules/invoice/infra/fiscal/rtc/rtc-mapper.ts` (somente a interface; implementação na Task 3)
- Create: `src/modules/invoice/infra/fiscal/rtc/rtc.metrics.ts`
- Modify: `src/modules/invoice/invoice.module.ts` (provider `RtcCalculatorPort`: `HttpRtcCalculatorAdapter` quando `RTC_CALCULATOR_URL` existe, senão `UnconfiguredRtcCalculator`)
- Test: `circuit-breaker.spec.ts`, `http-rtc-calculator.adapter.spec.ts` (servidor HTTP local de teste)

**Interfaces:**
- Consumes: `RtcCalculatorPort`, `RtcCalculationInput`, `RtcTaxResult`, `fiscalError` (plano 2); `RtcConfig` (Task 1).
- Produces:
  ```ts
  // rtc-mapper.ts — o fluxo real tem DUAS chamadas: base da NFS-e e depois o cálculo
  export interface RtcMapper {
    toBaseRequest(input: RtcCalculationInput): { path: '/calculadora/nfse/base-calculo'; body: unknown };
    fromBaseResponse(body: unknown): Result<DecimalString, FiscalError>;                  // → baseCalculo
    toCalcRequest(input: RtcCalculationInput, baseCalculo: DecimalString): { path: '/calculadora/regime-geral'; body: unknown };
    fromCalcResponse(body: unknown, input: RtcCalculationInput, calculatorVersion: string): Result<RtcTaxResult, FiscalError>;
    fromProblem(status: number, body: unknown): FiscalError | null;                       // application/problem+json de 4xx
  }
  // circuit-breaker.ts
  export class CircuitBreaker { constructor(opts: { failureThreshold: number; resetMs: number; now?: () => number }); canPass(): boolean; onSuccess(): void; onFailure(): void; readonly state: 'closed' | 'open' | 'half-open' }
  // http-rtc-calculator.adapter.ts
  export class HttpRtcCalculatorAdapter extends RtcCalculatorPort { constructor(config: RtcConfig, mapper: RtcMapper, http?: typeof fetch) }
  ```
  Fluxo de `calculate(input)`: `version()` (cache 60 s; `GET /calculadora/dados-abertos/versao` ⇒ `"{versaoApp}/{versaoDb}"`) → `POST nfse/base-calculo` → `POST regime-geral`; a falha de qualquer etapa interrompe as seguintes. Todos os caminhos são relativos a `RTC_CALCULATOR_URL` (que já termina em `/api`).
  Mapeamento de falhas (independente do schema): rede/abort/timeout ⇒ `TAX_CALCULATION_UNAVAILABLE`, `INTEGRATION`, `retryable: true`, `details.reason 'timeout'|'network'`; HTTP 5xx ⇒ idem `reason 'upstream_5xx'`; HTTP 429 ⇒ idem `reason 'rate_limited'` com `details.retryAfterMs` (de `Retry-After`); conexão recusada/reiniciando (serviço ainda em partida) conta como `network` ⇒ retryable, **nunca** rejeita a invoice de imediato; circuito aberto ⇒ `TAX_CALCULATION_UNAVAILABLE` retryable `reason 'circuit_open'` **sem chamar a rede**; HTTP 4xx ⇒ `mapper.fromProblem`, e se `null` ⇒ `TAX_CALCULATION_UNSUPPORTED` (`UNSUPPORTED`, `details.status`); 2xx cujo corpo não é JSON ⇒ `FISCAL_VALIDATION_FAILED` `rtc_invalid_response` (não retryable); 2xx válido ⇒ `mapper.from*Response`.

- [ ] **Step 1: Write the failing tests**

`circuit-breaker.spec.ts`:
```ts
it('opens after N consecutive failures and rejects without passing', () => {
  let t = 0;
  const cb = new CircuitBreaker({ failureThreshold: 3, resetMs: 1000, now: () => t });
  cb.onFailure(); cb.onFailure(); expect(cb.canPass()).toBe(true);
  cb.onFailure(); expect(cb.state).toBe('open'); expect(cb.canPass()).toBe(false);
});
it('goes half-open after resetMs and closes on success', () => {
  let t = 0;
  const cb = new CircuitBreaker({ failureThreshold: 1, resetMs: 1000, now: () => t });
  cb.onFailure(); t = 1001;
  expect(cb.canPass()).toBe(true); expect(cb.state).toBe('half-open');
  cb.onSuccess(); expect(cb.state).toBe('closed');
});
it('a success resets the failure count', () => {
  const cb = new CircuitBreaker({ failureThreshold: 3, resetMs: 1000 });
  cb.onFailure(); cb.onFailure(); cb.onSuccess(); cb.onFailure(); cb.onFailure();
  expect(cb.state).toBe('closed');
});
it('reopens when the half-open probe fails', () => {
  let t = 0;
  const cb = new CircuitBreaker({ failureThreshold: 1, resetMs: 1000, now: () => t });
  cb.onFailure(); t = 1001; expect(cb.canPass()).toBe(true);
  cb.onFailure(); expect(cb.state).toBe('open'); expect(cb.canPass()).toBe(false);
});
```

`http-rtc-calculator.adapter.spec.ts` — sobe um `http.createServer` local por teste (porta efêmera) que imita a Calculadora (`GET …/versao` → `{versaoApp:'1.6.0',versaoDb:'V0059',…}`, `POST …/base-calculo`, `POST …/regime-geral`) e um mapper fake (`toBaseRequest` → body `{}`, `fromBaseResponse` → ok `'870.00'`, `toCalcRequest` → body `{}`, `fromCalcResponse` → ok resultado fixo):
```ts
it('runs version → base → calc in order and returns the mapped result', ...);       // servidor registra a sequência de caminhos
it('stops after the base call fails (calc is not called)', ...);
it('maps a timeout to a retryable TAX_CALCULATION_UNAVAILABLE', ...);                // servidor nunca responde; timeoutMs 50
it('maps connection refused (service still starting) to a retryable error', ...);    // porta fechada
it('maps 503 to a retryable error', ...);
it('maps 429 with Retry-After to retryAfterMs', ...);                                // header 'retry-after: 2' → 2000
it('opens the circuit after the threshold and then does not call the network', ...); // contador de requests no servidor
it('maps an unknown 4xx to TAX_CALCULATION_UNSUPPORTED', ...);
it('uses mapper.fromProblem for a known 4xx', ...);
it('rejects a non-JSON 200 body as rtc_invalid_response (not retryable)', ...);
it('never leaks raw HTTP/SDK errors (every failure is a FiscalError)', ...);
it('limits concurrency to RTC_CALCULATOR_MAX_CONCURRENCY', ...);                    // 20 chamadas, servidor mede pico ≤ limite
it('version() reads and caches versaoApp/versaoDb for 60 s', ...);
it('health() is available:true only when the version endpoint answers 200', ...);
it('does not log the request body', ...);                                            // spy no Logger
```

- [ ] **Step 2: Run to verify they fail** — `yarn jest src/modules/invoice/infra/fiscal/rtc` → FAIL.

- [ ] **Step 3: Implement.** `circuit-breaker.ts`:
```ts
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private halfOpen = false;
  private readonly now: () => number;
  constructor(private readonly opts: { failureThreshold: number; resetMs: number; now?: () => number }) {
    this.now = opts.now ?? Date.now;
  }
  get state(): 'closed' | 'open' | 'half-open' {
    if (this.openedAt === null) return 'closed';
    return this.halfOpen ? 'half-open' : 'open';
  }
  canPass(): boolean {
    if (this.openedAt === null) return true;
    if (this.now() - this.openedAt >= this.opts.resetMs) { this.halfOpen = true; return true; }
    return false;
  }
  onSuccess(): void { this.failures = 0; this.openedAt = null; this.halfOpen = false; }
  onFailure(): void {
    this.failures += 1;
    if (this.halfOpen || this.failures >= this.opts.failureThreshold) {
      this.openedAt = this.now();
      this.halfOpen = false;
    }
  }
}
```
`rtc-http-client.ts`: `RtcHttpClient.request({ path, method, body })` com `AbortController` (`timeoutMs`), semáforo de concorrência (fila em memória), `fetch` injetável; devolve `{ status, headers, text }` ou lança `RtcTransportError('timeout' | 'network')` (classe local, nunca exportada). `http-rtc-calculator.adapter.ts` orquestra `breaker.canPass()` → chamadas → classificação conforme **Mapeamento de falhas**; `onFailure` para timeout/rede/5xx/429, `onSuccess` para 2xx e 4xx (o motor respondeu). Métricas (`rtc.metrics.ts`, meter `greenflow.rtc`): `rtc_calculation_duration` (histograma, atributo `outcome`), `rtc_calculation_failed_total{reason}`, `rtc_calculator_latency`. Wiring no `invoice.module.ts`:
```ts
{
  provide: RtcCalculatorPort,
  useFactory: (config: ConfigService, mapper: RtcMapper) => {
    const rtc = config.get<RtcConfig>('rtc');
    return rtc?.url ? new HttpRtcCalculatorAdapter(rtc, mapper) : new UnconfiguredRtcCalculator();
  },
  inject: [ConfigService, RTC_MAPPER],
}
```
`RTC_MAPPER` provê o `DefaultRtcMapper` da Task 3. As Tasks 2 e 3 devem ser mergeadas juntas (não faça deploy entre elas).

- [ ] **Step 4: Run to verify they pass** — `yarn jest src/modules/invoice/infra/fiscal/rtc && yarn typecheck` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(rtc): add HTTP calculator adapter with timeout, circuit breaker and error mapping"`

---

## Task 3: Mapper do contrato oficial (fixtures reais)

**Files:**
- Create: `src/modules/invoice/infra/fiscal/rtc/default-rtc-mapper.ts`, `default-rtc-mapper.spec.ts`
- Create: `src/shared/fiscal/ibge-uf.ts`, `ibge-uf.spec.ts`
- Modify: `src/modules/invoice/domain/fiscal/rtc/rtc-calculator.port.ts` (`RtcCalculationInput` ganha `issAmount: DecimalString | null`)
- Modify: `src/modules/invoice/application/fiscal/steps/rtc-tax-calculator.step.ts` e seu spec (preenche `issAmount` com `context.legacyTaxes?.iss?.amount ?? null`)

**Interfaces:**
- Consumes: `RtcMapper` (Task 2), fixtures `docs/fiscal/rtc/fixtures/*.json`, `assertRtcResultConsistent` (plano 2, Task 13).
- Produces: `DefaultRtcMapper implements RtcMapper`; `ufFromIbge(code: string): string | null` (primeiros 2 dígitos → sigla; tabela IBGE: 11 RO, 12 AC, 13 AM, 14 RR, 15 PA, 16 AP, 17 TO, 21 MA, 22 PI, 23 CE, 24 RN, 25 PB, 26 PE, 27 AL, 28 SE, 29 BA, 31 MG, 32 ES, 33 RJ, 35 SP, 41 PR, 42 SC, 43 RS, 50 MS, 51 MT, 52 GO, 53 DF).

Contrato (de `docs/fiscal/rtc/README.md`):
- **Base:** `toBaseRequest` → `{ anoFatoGerador: <ano de competenceDate>, valorServico: <gross como number>, descontoIncondicional: <discount como number, omitir se 0>, iss: <issAmount como number, omitir se null> }`. **PIS/COFINS nunca são enviados** (retenções federais não entram na base de IBS/CBS aqui; proibidos a partir de 2027). `fromBaseResponse`: `{ baseCalculo: number }` ⇒ `DecimalString` (2 casas); ausente/não numérico ⇒ `FISCAL_VALIDATION_FAILED` `rtc_invalid_response`.
- **Cálculo:** `toCalcRequest` → `{ id: <invoiceId ou 'preview'>, versao: '1.0.0', dhFatoGerador: '<competenceDate>T12:00:00Z', municipio: <Number(incidenceMunicipalityCode)>, uf: ufFromIbge(incidenceMunicipalityCode), itens: [{ numero: 1, nbs, cst, cClassTrib, baseCalculo: <base como number> }] }`. **Nunca** envia `aliquotasNominais`.
- **Resposta:** `objetos[0].tribCalc.IBSCBS.gIBSCBS` → `TaxAmount`: `base = vBC`; `rate = pCBS|pIBSUF|pIBSMun`; `effectiveRate = gRed.pAliqEfet ?? rate`; `reductionRate = gRed.pRedAliq ?? '0'`; `amount = vCBS|vIBSUF|vIBSMun`; `ibsTotal = { base: vBC, amount: vIBS }`; `calculationMemory = [memoriaCalculo de cada grupo]`; `legalReferences = []` (o motor traz a fundamentação dentro de `memoriaCalculo`); `collectionWaived = false` (a dispensa é decidida pela aplicabilidade/regra, não pelo motor).
- **Rejeições (não retryable):** `objetos[0].calculoSimulado === true` ⇒ `TAX_RATE_NOT_FOUND` (`CONFIGURATION`, `details.reason 'simulated_result'`); qualquer `gDif` (diferimento) presente com valor ≠ 0 ⇒ `TAX_CALCULATION_UNSUPPORTED` (`details.reason 'deferral_not_supported'`); campo obrigatório ausente, tipo errado ou valor negativo ⇒ `FISCAL_VALIDATION_FAILED` `rtc_invalid_response` com `details.path`.
- **Problemas HTTP (`fromProblem`)**, pelo sufixo de `type`: `aliquotas-nominais-nao-informadas` (422) e `aliquota-nao-encontrada` (404) ⇒ `TAX_RATE_NOT_FOUND` (`CONFIGURATION`; **é o bloqueio de 2027+**: a base do governo ainda não tem alíquotas e a Corvo não as estima); `classificacao-tributaria-nao-encontrada` (404) ⇒ `FISCAL_CLASSIFICATION_INVALID` (`CLASSIFICATION`); demais ⇒ `null`.

- [ ] **Step 1: Write the failing tests**

`ibge-uf.spec.ts`: `ufFromIbge('3550308')` ⇒ `'SP'`; `'5300108'` ⇒ `'DF'`; `'9999999'` ⇒ `null`; `'abc'` ⇒ `null`.

`default-rtc-mapper.spec.ts`:
```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DefaultRtcMapper } from './default-rtc-mapper';

const dir = join(process.cwd(), '..', 'docs/fiscal/rtc/fixtures');
const load = (name: string) => JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));
const mapper = new DefaultRtcMapper();

describe('DefaultRtcMapper (real captured fixtures)', () => {
  it('builds the base request exactly as the engine accepted it', () => {
    const f = load('ok-base-calculo-nfse-2026');
    const input = { ...load('ok-consultoria-2026').input, competenceDate: '2026-12-10', grossAmount: '1000.00', discountAmount: '100.00', issAmount: '30.00' };
    expect(mapper.toBaseRequest(input).body).toEqual(f.steps[0].request);
    expect(mapper.fromBaseResponse(f.steps[0].response)).toEqual({ ok: true, value: '870.00' });
  });

  it('builds the calc request from the base and maps the response to the typed result', () => {
    const f = load('ok-consultoria-2026');
    expect(mapper.toCalcRequest(f.input, '1000.00').body).toEqual({ ...f.steps[0].request, id: expect.any(String) });
    expect(mapper.fromCalcResponse(f.steps[0].response, f.input, '1.6.0/V0059')).toEqual({
      ok: true,
      value: expect.objectContaining({ ...f.expected, legalReferences: [], calculationMemory: expect.any(Array) }),
    });
  });

  it('maps the 60% reduction (effective rate and reduction rate)', () => {
    const f = load('ok-reducao-60-2026');
    const r = mapper.fromCalcResponse(f.steps[0].response, f.input, '1.6.0/V0059');
    expect(r.ok && r.value.cbs).toEqual(f.expected.cbs);
    expect(r.ok && r.value.ibsState).toEqual(f.expected.ibsState);
  });

  it('never sends nominal rates', () => {
    const f = load('ok-consultoria-2026');
    expect(JSON.stringify(mapper.toCalcRequest(f.input, '1000.00').body)).not.toContain('aliquotasNominais');
  });

  it.each(['error-2027-aliquotas-nominais', 'error-classificacao-nao-encontrada'])('%s maps to the expected typed error', (name) => {
    const f = load(name);
    const step = f.steps[0];
    expect(mapper.fromProblem(step.status, step.response)).toMatchObject({ ...f.expectedError });
  });

  it('returns null for an unknown problem type', () => {
    expect(mapper.fromProblem(400, { type: 'http://localhost/errors/outro', status: 400 })).toBeNull();
  });

  it('rejects a simulated result', () => {
    const f = load('ok-consultoria-2026');
    const body = JSON.parse(JSON.stringify(f.steps[0].response));
    body.objetos[0].calculoSimulado = true;
    expect(mapper.fromCalcResponse(body, f.input, 'v')).toMatchObject({ ok: false, error: { code: 'TAX_RATE_NOT_FOUND', retryable: false } });
  });

  it('rejects a response missing a required amount, with the missing path', () => {
    const f = load('ok-consultoria-2026');
    const body = JSON.parse(JSON.stringify(f.steps[0].response));
    delete body.objetos[0].tribCalc.IBSCBS.gIBSCBS.gCBS.vCBS;
    expect(mapper.fromCalcResponse(body, f.input, 'v')).toMatchObject({ ok: false, error: { code: 'FISCAL_VALIDATION_FAILED', details: { reason: 'rtc_invalid_response' } } });
  });

  it('rejects wrong types and negative amounts', () => {
    const f = load('ok-consultoria-2026');
    const wrong = JSON.parse(JSON.stringify(f.steps[0].response));
    wrong.objetos[0].tribCalc.IBSCBS.gIBSCBS.gCBS.vCBS = 'abc';
    expect(mapper.fromCalcResponse(wrong, f.input, 'v').ok).toBe(false);
    const neg = JSON.parse(JSON.stringify(f.steps[0].response));
    neg.objetos[0].tribCalc.IBSCBS.gIBSCBS.gCBS.vCBS = '-1.00';
    expect(mapper.fromCalcResponse(neg, f.input, 'v').ok).toBe(false);
  });

  it('rejects a non-zero deferral instead of ignoring it', () => {
    const f = load('ok-consultoria-2026');
    const body = JSON.parse(JSON.stringify(f.steps[0].response));
    body.objetos[0].tribCalc.IBSCBS.gIBSCBS.gCBS.gDif = { pDif: '10.00', vDif: '0.90' };
    expect(mapper.fromCalcResponse(body, f.input, 'v')).toMatchObject({ ok: false, error: { code: 'TAX_CALCULATION_UNSUPPORTED' } });
  });

  it('keeps monetary values as decimal strings without float drift', () => {
    const f = load('ok-consultoria-2026');
    const body = JSON.parse(JSON.stringify(f.steps[0].response));
    body.objetos[0].tribCalc.IBSCBS.gIBSCBS.gCBS.vCBS = '0.30';
    const r = mapper.fromCalcResponse(body, f.input, 'v');
    expect(r.ok && r.value.cbs?.amount).toBe('0.30');
  });
});
```
(Ajuste `ok-consultoria-2026.json` → `input` já contém os campos de `RtcCalculationInput` do plano 2; acrescente-lhe `issAmount` conforme o novo campo. Se algum `expected` das fixtures divergir do mapper por convenção de formatação, **corrija a convenção no mapper**, não o dado capturado; só altere `expected` se o contrato do `RtcTaxResult` mudar, e registre o motivo.)

- [ ] **Step 2: Run to verify they fail** — `yarn jest src/modules/invoice/infra/fiscal/rtc src/shared/fiscal/ibge-uf.spec.ts` → FAIL.

- [ ] **Step 3: Implement** `ibge-uf.ts`, `DefaultRtcMapper` (conversões para `number` só nas bordas de `toBaseRequest`/`toCalcRequest` com `Decimal#toNumber()`; respostas sempre via `toDecimal(string)`), a extensão de `RtcCalculationInput.issAmount` e o ajuste do step do plano 2.

- [ ] **Step 4: Run to verify they pass** — `yarn jest src/modules/invoice src/shared/fiscal && yarn typecheck && yarn typecheck:tests` → PASS (incluindo os testes do plano 2 que usam `RtcCalculatorPort`).

- [ ] **Step 5: Teste de contrato contra a instância real (etiquetado).** `rtc-contract.rtc-integration.spec.ts`, `describe.skip` sem `RTC_CALCULATOR_URL`: para cada fixture `ok-*`, executa `steps[].request` na instância e confere `expected`. Rode: `RTC_CALCULATOR_URL=http://localhost:18080/api yarn jest rtc-integration`. Registre data e versão (`1.6.0/V0059`) em `docs/fiscal/homologation.md`.

- [ ] **Step 6: Commit** — `git commit -m "feat(rtc): map the official calculator contract with real fixtures"`

---

## Task 4: Validação de NBS / CST / cClassTrib / cIndOp por consulta à Calculadora

Os catálogos da Calculadora **não trazem datas de vigência**: cada resposta vale para o parâmetro `data`. Por isso, em vez de arquivos JSON versionados, a validação consulta o motor com a **data da competência** (e guarda a versão dos dados no snapshot). cTribNac continua no JSON do plano 2 (o motor não tem a lista nacional).

**Files:**
- Modify (plano 2): `src/modules/invoice/domain/fiscal/classification/fiscal-catalog.port.ts`, `classify-service.ts`, `application/fiscal/steps/service-tax-classifier.step.ts` e seus specs
- Create: `src/modules/invoice/infra/fiscal/rtc/rtc-fiscal-catalog.ts`, `rtc-fiscal-catalog.spec.ts`
- Create: `src/modules/invoice/infra/fiscal/composite-fiscal-catalog.ts`
- Modify: `src/modules/invoice/invoice.module.ts`

**Interfaces:**
- Modifica o port do plano 2 para **assíncrono** e com transitoriedade explícita:
  ```ts
  export type ClassificationValidation =
    | { status: 'validated'; versions: Record<string, string> }
    | { status: 'unavailable'; reason: string; transient: boolean }      // transient=true: motor fora do ar
    | { status: 'invalid'; issues: Array<{ field: string; reason: string }> }
    | { status: 'ambiguous'; candidates: Array<{ cst: string; classCode: string }> };
  abstract validateClassification(input: {...}, date: string): Promise<ClassificationValidation>;
  // classifyService passa a ser async; o step faz await. Quando status === 'unavailable' && transient,
  // o classificador devolve TAX_CALCULATION_UNAVAILABLE (INTEGRATION, retryable) — NÃO marca catalogValidated=false.
  ```
- `RtcFiscalCatalog implements` a validação usando o `RtcHttpClient` da Task 2 e estes endpoints: `GET /calculadora/dados-abertos/nbs/lista?data=` (NBS existe), `GET /calculadora/nfse/situacoes-classificacoes-tributarias?nbs=&data=` (o par CST × cClassTrib informado precisa estar na lista da NBS; lista com **uma** combinação e nada informado ⇒ pode ser proposta como `validated`/inequívoca; mais de uma e nada informado ⇒ `ambiguous` com `candidates`), `POST /calculadora/nfse/indicador-operacao/validate` (cIndOp × cClassTrib × NBS × cTribNac — **capture a fixture real na Step 1**), `GET /calculadora/nfse/indicador-operacao?dataOcorrenciaFatoGerador=&nbs=` (lista de cIndOp possíveis).
- Cache em memória por `(endpoint, parâmetros, data)` com TTL de 6 h e limpeza quando `versaoApp/versaoDb` mudar (checar a versão a cada 60 s); `versions` devolvido: `{ rtc: '1.6.0/V0059' }`.
- `CompositeFiscalCatalog extends IFiscalCatalog`: `lookupServiceCode` vem do `JsonFiscalCatalog` (cTribNac); `validateClassification` vem do `RtcFiscalCatalog` quando o RTC está configurado, senão `{ status: 'unavailable', transient: false }`.

- [ ] **Step 1: Capturar a fixture de `indicador-operacao/validate`.** Com a Calculadora local no ar, descubra o corpo (`NfseValidacaoIndicadorOperacaoInput` no `openapi.json`), chame com um cIndOp retornado por `GET nfse/indicador-operacao?…&nbs=115011000` (válido) e com um incompatível, e salve as duas respostas em `docs/fiscal/rtc/fixtures/ok-indicador-valido.json` e `error-indicador-incompativel.json` (mesmo formato das outras).

- [ ] **Step 2: Write the failing tests** (servidor HTTP fake que serve as respostas reais já capturadas: lista de NBS contendo `115011000`, `situacoes-classificacoes` ⇒ `[{ cst '000', classe '000001' }]`, e as fixtures do Step 1): NBS inexistente ⇒ `invalid`; par CST × cClassTrib fora da lista da NBS ⇒ `invalid`; par correto ⇒ `validated` com `versions.rtc`; nada informado e uma combinação ⇒ proposta inequívoca; duas combinações ⇒ `ambiguous` com `candidates`; cIndOp incompatível ⇒ `invalid`; **a data da competência é enviada** em todas as consultas (assert no servidor); segunda chamada igual vem do cache (contador no servidor); mudança de `versaoDb` invalida o cache; motor fora do ar ⇒ `unavailable` com `transient: true`; RTC não configurado ⇒ `unavailable` com `transient: false`. No classificador do plano 2: `transient` ⇒ erro retryable `TAX_CALCULATION_UNAVAILABLE`; `invalid` ⇒ `FISCAL_CLASSIFICATION_INVALID` com `details.issues`.

- [ ] **Step 3: Run (FAIL) → implement → run (PASS)** — `yarn jest src/modules/invoice && yarn typecheck && yarn typecheck:tests`. Atualize os specs do plano 2 (`classify-service.spec.ts`, `service-tax-classifier.step.spec.ts`, `tax-applicability.step.spec.ts`) para `await`, e confirme que `catalogValidated` passa a `true` com o catálogo real.

- [ ] **Step 4: Commit** — `git commit -m "feat(fiscal): validate NBS, CST, cClassTrib and cIndOp against the calculator by competence date"`

---

## Task 5: DpsBuilder (Builder, sem regra fiscal)

**Files:**
- Modify: `test/__mocks__/open-nfse.ts` (re-exportar `validateDpsXml`, `FinalidadeNFSe`, `IndicadorDestinatario`, `IndicadorFinal`, `TipoRetISSQN`, `TipoTribISSQN`, `signDpsXml` do `sdk`)
- Create: `src/modules/invoice/domain/fiscal/dps/dps-layout.ts`
- Create: `src/modules/invoice/domain/fiscal/dps/dps-builder.ts`
- Test: `dps-builder.spec.ts`

**Interfaces:**
- Consumes: `FiscalCalculationResult` (plano 2), tipos `DPS`, `BuildDpsParams`, `buildDps`, enums do `open-nfse`.
- Produces:
  ```ts
  export type DpsLayoutStatus = 'published' | 'homologated' | 'in_production';
  export interface DpsLayout { id: 'rtc-v1.01'; status: DpsLayoutStatus }
  export const ACTIVE_LAYOUTS: Record<string, DpsLayout>;   // { 'rtc-v1.01': { id: 'rtc-v1.01', status: 'in_production' } }
  export interface DpsBuildInput {
    result: FiscalCalculationResult;
    specialTaxRegime: string | null;
    invoice: { grossAmount: DecimalString; discountAmount: DecimalString; description: string; serviceMunicipalityCode: string; competenceDate: string; issuedAt: Date; environment: 'test' | 'live' };
    company: { taxId: string; municipalityCode: string; municipalRegistration: string | null };
    customer: { kind: 'CPF' | 'CNPJ'; taxId: string; name: string } | null;
    series: string;
    number: number;
  }
  export class DpsBuilder { build(input: DpsBuildInput, layoutId: string): Result<DPS, FiscalError> }
  ```
  Erros: layout desconhecido ou `status !== 'in_production'` ⇒ `DPS_LAYOUT_UNSUPPORTED` (acrescente o código a `FISCAL_ERROR_CODES`, categoria `UNSUPPORTED`); campo exigido pelo layout e ausente ⇒ `DPS_SCHEMA_VALIDATION_FAILED` (acrescente também; `VALIDATION`).

Regras de montagem (todas com teste; o builder **traduz**, não decide):
1. Regime: `MEI → OpcaoSimplesNacional.Mei`; `SIMPLES_NACIONAL → MeEpp` com `regApTribSN = FederalEMunicipalPeloSN`; demais ⇒ `NaoOptante`. `regEspTrib` de `specialTaxRegime` (`Number` como hoje; vazio ⇒ `0`). 
2. Base: `buildDps({ emitente, serie, nDPS: String(number), tpAmb (live→Producao, test→Homologacao), dhEmi: issuedAt, dCompet: <competenceDate>T12:00:00Z (como issue-params.ts), verAplic ('Corvo' | 'Corvo-test'), servico: { cTribNac: result.classification.serviceCode, cNBS: result.classification.nbsCode ?? undefined, descricao, codMunicipioPrestacao }, valores, tomador, skipCpfCnpjValidation: false })`.
3. `valores`: `vServ` = bruto como `number` via `Decimal#toNumber()` (borda do SDK); `aliqIss` somente se `result.taxes.iss` e o município de incidência não for do Sistema Nacional (a lib/regra decide — quando houver `iss.rate`, informe); `tribISSQN = OperacaoTributavel`; `tpRetISSQN = RetidoPeloTomador` se `result.withholdings` contém ISS retido (`applicability.issWithheld.status === 'REQUIRED'`) senão `NaoRetido`; `vTotTrib: { vTotTribFed: 0, vTotTribEst: 0, vTotTribMun: 0 }` (mantém o comportamento atual; registre a limitação em `docs/fiscal/limitations.md`).
4. Desconto: se `discountAmount > 0`, após `buildDps`, produza uma nova `DPS` com `infDPS.valores.vDescCondIncond = { vDescIncond: <number> }` (objetos do SDK são `readonly`: use spread).
5. Tomador: `customer === null` ⇒ omitir `toma` **e** `tomador` (a DPS sem tomador só é construída quando `applicability.customerRequired === false`; caso contrário `DPS_SCHEMA_VALIDATION_FAILED`).
6. **Grupo `IBSCBS`** somente quando `applicability.cbs.status === 'REQUIRED'` ou `ibs.status === 'REQUIRED'` **e** `classification` completa: `{ finNFSe: FinalidadeNFSe.Regular, cIndOp: classification.operationIndicator, indDest: IndicadorDestinatario.TomadorEhDestinatario, valores: { trib: { gIBSCBS: { CST: classification.cst, cClassTrib: classification.classCode } } } }`. `indFinal`, `tpOper`, `dest`, `imovel`, `gRefNFSe`, `tpEnteGov` **não** são preenchidos sem dado confirmado (confira cada campo contra `RtcInfoIbsCbs`/XSD; se o XSD exigir algum desses para o cenário, o passo de validação XSD (item 7) falhará e a task deve parar e levar a decisão ao responsável — não preencher por suposição). Valores calculados de CBS/IBS **não** entram na DPS (são consolidados pela Sefin).
7. Validação: depois de montar, rode `validateDpsXml(buildDpsXml(dps))` (símbolos do SDK; veja o resultado em `validate-xml.d.ts`) — se inválido ⇒ `DPS_SCHEMA_VALIDATION_FAILED` com `details.violations` (limitado a 20, sem dados pessoais).

- [ ] **Step 1: Estender o mock** com as re-exportações listadas (mesmo padrão das linhas existentes: `export const validateDpsXml = sdk.validateDpsXml;` etc.).

- [ ] **Step 2: Write failing tests** `dps-builder.spec.ts` (SDK real via mock; resultados fiscais montados por helpers do spec a partir de `FiscalCalculationResult` completos — use as classificações `SYNTHETIC_*` **apenas** para exercitar o encaixe estrutural e **nunca** rode `validateDpsXml` com elas: para o teste de XSD use códigos reais extraídos dos JSON de catálogo da Task 4 no `beforeAll`):

```ts
it('MEI without customer builds a DPS with Mei regime and no IBSCBS group', ...);
it('Simples builds MeEpp with regApTribSN', ...);
it('regular regime with IBS/CBS required includes IBSCBS with the classification codes (real catalog codes) and passes XSD validation', ...);
it('does not include IBSCBS when neither CBS nor IBS is required', ...);
it('unconditional discount is added as vDescIncond', ...);
it('ISS withheld by the customer sets tpRetISSQN to RetidoPeloTomador', ...);
it('alphanumeric CNPJ for provider and customer is accepted', ...);        // CNPJ alfanumérico gerado com DV válido
it('customer null + customerRequired true is a DPS_SCHEMA_VALIDATION_FAILED', ...);
it('unknown or non-production layout is DPS_LAYOUT_UNSUPPORTED', ...);   // 'rtc-v1.04' e status 'published'
it('never puts CBS/IBS amounts in the DPS', ...);                        // JSON do dps não contém vCBS/vIBS
it('is deterministic for the same input', ...);
```

- [ ] **Step 3: Run (FAIL) → implement → run (PASS)** — `yarn jest src/modules/invoice/domain/fiscal/dps && yarn typecheck`. Adicione `DPS_LAYOUT_UNSUPPORTED` e `DPS_SCHEMA_VALIDATION_FAILED` ao `fiscal-error.ts`.

- [ ] **Step 4: Commit** — `git commit -m "feat(fiscal): add DPS builder for the RTC v1.01 layout"`

---

## Task 6: Layout ativo e integração do DpsBuilder no workflow

**Files:**
- Modify: `src/infra/external/nfse/nfse-fiscal-provider.ts` (`IIssuePayload.preparedDps?: DPS`)
- Modify: `src/modules/invoice/application/nfse-workflow.service.ts` (`payload()` usa `DpsBuilder` quando há snapshot)
- Modify: `src/modules/invoice/invoice.module.ts` / `worker-app.module.ts` (provider `DpsBuilder`)
- Modify: `src/infra/external/nfse/fake-nfse.provider.ts`
- Test: `nfse-workflow.service.spec.ts`, `fake-nfse.provider.spec.ts`

**Interfaces:**
- Consumes: `DpsBuilder`, `ACTIVE_LAYOUTS`, `IFiscalSnapshotRepository`, `FiscalError`.
- Produces: `IIssuePayload.preparedDps?: DPS`; `NfseWorkflowService.payload(invoice)` devolve o payload com `preparedDps` quando o snapshot existe, e rejeita a invoice (`rejectBeforeProcessing`) com o código do erro de DPS quando o builder falha.

Regras: layout vem de `config.rtc.dpsLayout` (`FISCAL_DPS_LAYOUT`); com o snapshot presente o payload mantém os campos legados (emitente, servico, valores) **e** `preparedDps`; sem snapshot (flag desligada) nada muda. Falha do builder (`DPS_LAYOUT_UNSUPPORTED`/`DPS_SCHEMA_VALIDATION_FAILED`) ocorre **antes** da transição `queued → processing` e **antes** de reservar numeração? A numeração (`sequences.reserveNext`) acontece hoje dentro de `payload()` antes de montar o XML — reordene: o builder precisa do `number`, então reserve a numeração, monte a DPS e, se o builder falhar, a numeração já reservada **fica associada à invoice** (`invoice.setDpsInfo` + `invoices.save`) e a invoice é rejeitada; isso preserva "nunca reutilizar numeração" (o número é consumido e documentado). Registre esse comportamento em `docs/fiscal/limitations.md`.

- [ ] **Step 1: Write failing tests** (workflow, com `DpsBuilder` e repositórios mockados): snapshot presente ⇒ `payload.preparedDps` definido e `providers.issue` recebe-o; builder falha com `DPS_LAYOUT_UNSUPPORTED` ⇒ `rejectBeforeProcessing(invoice, 'DPS_LAYOUT_UNSUPPORTED', …)` e nenhuma chamada a `issue`; numeração reservada é persistida antes da falha; sem snapshot ⇒ `preparedDps` ausente e fluxo legado intacto; `FakeNfseProvider` com `preparedDps` produz XML autorizado simulado contendo o grupo `IBSCBS` da DPS (use `buildDpsXml(preparedDps)`) e `parseNfseXml` o aceita.

- [ ] **Step 2: Run (FAIL) → implement → run (PASS)** — `yarn jest src/modules/invoice src/infra/external && yarn typecheck && yarn typecheck:tests`.

- [ ] **Step 3: Commit** — `git commit -m "feat(fiscal): build the DPS from the fiscal snapshot in the emission workflow"`

---

## Task 7: Emissão da DPS pronta com `OpenNfseProvider` (assinar → pendente → replay)

**Files:**
- Modify: `src/infra/external/nfse/open-nfse.provider.ts`
- Modify: `test/support/` + `test/jest-fiscal.json` (mapa `open-nfse/testing` nativo e novo spec)
- Create: `test/fiscal-dps-emission.e2e-spec.ts`
- Create: `test/support/open-nfse-testing-native.ts`

**Interfaces:**
- Consumes: `IIssuePayload.preparedDps` (Task 6), `NfseClient#emitirDpsPronta`, `RetryStore`, `replayPendingEvents`.
- Produces: `OpenNfseProvider.issue(payload)` com o caminho `preparedDps`:
  1. `store.list()` ⇒ se há pendente `emission`: consulta `fetchDpsStatus(pending.idDps)` → se existir, `fetchByChave` e devolve o resultado (mesmo comportamento de hoje); `NotFoundError` ⇒ segue.
  2. Sem pendente: `client.emitirDpsPronta(payload.preparedDps, { dryRun: true })` ⇒ `xmlDpsAssinado`; `idDps = preparedDps.infDPS.Id`; grava `PendingEmission` (mesmos campos de hoje) **antes** de transmitir.
  3. `client.replayPendingEvents(store)` como hoje; mapeamento de `success_emission` / `failed_permanent` / `still_pending` idêntico ao atual.
  4. `skipValidation` **nunca** é passado.

- [ ] **Step 1: Verification tests (characterization)** em `test/fiscal-dps-emission.e2e-spec.ts` (jest-fiscal com SDK nativo e `NfseClientFake` real de `open-nfse/testing`; ajuste `jest-fiscal.json`: `testRegex: "test/fiscal-(environments|dps-emission)\\.e2e-spec\\.ts$"` e `"^open-nfse/testing$": "<rootDir>/test/support/open-nfse-testing-native.ts"`, cujo conteúdo segue o padrão de `open-nfse-native.ts` com `require('open-nfse/testing')`). Antes de implementar, **confirme lendo `node_modules/open-nfse/dist/testing/nfse-client-fake.d.ts`** como programar falhas (`ProgrammedFailure`) e quais métodos o fake suporta (`emitirDpsPronta`, `fetchDpsStatus`, `replayPendingEvents`). Casos:
  - (a) `emitirDpsPronta(dps, { dryRun: true })` devolve XML assinado sem transmitir (nenhuma chamada registrada no estado do fake);
  - (b) timeout programado no POST: `issue()` devolve `requiresReconciliation: true`; a segunda chamada de `issue()` para a mesma invoice **não** reassina nem gera novo `Id`, consulta `fetchDpsStatus` e, após o fake "autorizar" a DPS, devolve `success` com a chave — **uma única NFS-e** no estado do fake;
  - (c) 429 com `Retry-After` programado: o pendente guarda `notBefore` e o `issue()` seguinte antes do prazo devolve `requiresReconciliation: true` sem nova transmissão;
  - (d) rejeição fiscal permanente (`ReceitaRejectionError`) ⇒ `success:false`, `requiresReconciliation:false`, `errorCode` do SEFIN;
  - (e) DPS com `IBSCBS` inválida pelo XSD ⇒ falha **antes** de qualquer transmissão com `INVALID_FISCAL_INPUT`.
  Se algum comportamento (a)–(c) não for garantido pelo SDK/fake, **pare**, documente o gap em `docs/fiscal/limitations.md` e leve à decisão E2 do spec (manter `emitir(params)` vs adaptador próprio).

- [ ] **Step 2: Run to verify they fail** — `yarn test:fiscal:integration` → FAIL.

- [ ] **Step 3: Implement** o caminho `preparedDps` em `OpenNfseProvider.issue` reutilizando `store`, `buildDpsId` não é mais necessário (use `preparedDps.infDPS.Id`), `pendingEmissionId(idDps)` e a estrutura `PendingEmission` já existente. Código do ramo (substitui o bloco `if (!pending) {…}` quando `payload.preparedDps` existe):
```ts
if (!pending) {
  const signed = await client.emitirDpsPronta(payload.preparedDps!, { dryRun: true });
  if (!('dryRun' in signed) || !signed.dryRun) throw new Error('Expected signed DPS preview');
  const idDps = payload.preparedDps!.infDPS.Id;
  const now = new Date();
  pending = {
    kind: 'emission', id: pendingEmissionId(idDps), idDps, xmlAssinado: signed.xmlDpsAssinado,
    emitenteCnpj: payload.emitente.cnpj, serie: payload.serie, nDPS: String(payload.number),
    firstAttemptAt: now, lastAttemptAt: now,
    lastError: { message: 'Prepared before fiscal submission', errorName: 'Prepared', transient: true },
  };
  await store.save(pending);
}
```
(O `!` em `preparedDps` é seguro dentro do ramo guardado por `if (payload.preparedDps)`; prefira extrair `const prepared = payload.preparedDps` antes do `if` para evitar a asserção.)

- [ ] **Step 4: Run to verify they pass** — `yarn test:fiscal:integration && yarn jest src/infra/external && yarn typecheck`.

- [ ] **Step 5: Commit** — `git commit -m "feat(fiscal): sign and replay a prepared DPS with idempotent pending emission"`

---

## Task 8: Conciliação fiscal (tabela, serviço, job)

**Files:**
- Modify: `rls-tables.ts` (+ `'invoice_fiscal_reconciliations'`), `tenant-rls.postgres.integration.spec.ts` (contagem)
- Create: `src/infra/database/migrations/1791820000000-CreateInvoiceFiscalReconciliations.ts`
- Modify: `src/modules/invoice/domain/fiscal/policies/tax-rule.ts` e `rules/index.ts` (regra `reconciliation.tolerance`)
- Create: `src/modules/invoice/domain/fiscal/reconciliation/reconcile.ts`
- Create: `src/modules/invoice/domain/fiscal/reconciliation/fiscal-reconciliation.repository.ts`
- Create: `src/modules/invoice/infra/fiscal/invoice-fiscal-reconciliation.orm-entity.ts`, `typeorm-fiscal-reconciliation.repository.ts`
- Create: `src/modules/invoice/application/fiscal/fiscal-reconciliation.service.ts`
- Create: `src/modules/invoice/jobs/fiscal-reconciliation.processor.ts`
- Modify: `invoice.module.ts` (fila `nfse-fiscal-reconcile`), `worker-app.module.ts` (processor), `nfse-workflow.service.ts` (enfileira após `authorized`), `jobs/docs-recovery.scheduler.ts` (recuperação), `webhooks-config/domain/webhook-event.ts` (+ `'nfse.invoice.fiscal_discrepancy'` em `WebhookEventType` e `PUBLIC_WEBHOOK_EVENT_TYPES`)
- Test: `reconcile.spec.ts`, `fiscal-reconciliation.service.spec.ts`, `fiscal-reconciliation.processor.spec.ts`, repo integration spec, `docs-recovery.scheduler.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ReconciliationStatus = 'matched' | 'within_tolerance' | 'divergent';
  export interface ReconciliationDifference { field: string; local: string | null; authorized: string | null; delta: string | null; kind: 'amount' | 'missing_in_authorized' | 'missing_locally' }
  export interface ReconciliationOutcome { status: ReconciliationStatus; differences: ReconciliationDifference[]; localValues: Record<string, string | null>; authorizedValues: Record<string, string | null>; toleranceAbsolute: string }
  export function reconcile(local: FiscalCalculationResult, authorized: NFSe, toleranceAbsolute: Decimal): ReconciliationOutcome;
  export abstract class IFiscalReconciliationRepository { insert(row: ReconciliationRow): Promise<boolean>; findByInvoiceId(invoiceId: string, tenantId: string): Promise<ReconciliationRow | null>; findAuthorizedWithoutReconciliation(tenantId: string, olderThan: Date, limit: number): Promise<Array<{ id: string; tenantId: string; companyId: string }>> }
  export class FiscalReconciliationService { reconcileInvoice(invoiceId: string, tenantId: string): Promise<void> }
  ```
  Tabela `invoice_fiscal_reconciliations`: `id, invoice_id uuid UNIQUE REFERENCES nfse_invoices ON DELETE CASCADE, tenant_id, status varchar(20) CHECK, local_values jsonb, authorized_values jsonb, differences jsonb, tolerance_absolute varchar(12), rules_version varchar(20), reconciled_at`.

Campos comparados (extração do `NFSe` já tipado pelo SDK; números do SDK convertidos com `new Decimal(String(n))`): ISS `infNFSe.valores.vISSQN` ↔ `taxes.iss.amount`; base ISS `infNFSe.valores.vBC` ↔ `taxes.iss.base`; CBS `infNFSe.IBSCBS.totCIBS.gCBS.vCBS` ↔ `taxes.cbs.amount`; IBS total `…gIBS.vIBSTot` ↔ `taxes.ibsTotal.amount`; IBS-UF `…gIBSUFTot.vIBSUF` ↔ `taxes.ibsState.amount`; IBS-Mun `…gIBSMunTot.vIBSMun` ↔ `taxes.ibsCity.amount`; base IBS/CBS `infNFSe.IBSCBS.valores.vBC` ↔ `taxableAmounts.ibsCbs`; valor líquido `infNFSe.valores.vLiq` é apenas registrado (não compara com `netReceivableAmount`, definições diferentes).

Regras: campo presente só localmente ⇒ `missing_in_authorized` (`divergent`); só na autorizada ⇒ `missing_locally` (`divergent`); `|delta| = 0` ⇒ `matched`; `0 < |delta| ≤ tolerância` ⇒ `within_tolerance`; maior ⇒ `divergent`. Status final = pior entre os campos. Regra `reconciliation.tolerance` em `TAX_RULES`: `{ ruleKey: 'reconciliation.tolerance', validFrom: '2026-01-01', validUntil: null, legalReference: 'Política interna Corvo: tolerância de arredondamento de 1 centavo por tributo (pendente de confirmação fiscal — spec 3, E3)', sourceUrl: '', status: 'published', parameters: { absolute: '0.01' } }`.

Serviço: carrega snapshot (`IFiscalSnapshotRepository.findByInvoiceId`) e XML autorizado (`documentStorage.getXml(tenantId, invoiceId, invoice.storageEnvironment)`), `parseNfseXml`, `reconcile`, `repo.insert` (idempotente por `invoice_id`), métrica `tax_reconciliation_mismatches_total` (contador `greenflow.fiscal`) quando `divergent`, e — só no `divergent` e só na primeira inserção — webhook `nfse.invoice.fiscal_discrepancy` com `data { invoiceId, status, differences }` (sem XML, sem documentos completos) via o mesmo caminho de `emitWebhook` do workflow (extraia um serviço `InvoiceWebhookPublisher` pequeno, ou exponha método público no `NfseWorkflowService`; mantenha os testes existentes verdes). **Nunca** altera o snapshot, o XML ou o status da invoice. Sem snapshot (flag desligada) ⇒ no-op.

Processor: fila `nfse-fiscal-reconcile`, job `reconcile`, lock Redis `nfse:fiscal-reconcile:{invoiceId}` (padrão do `NfseDocPrepProcessor`), opções `attempts 5, backoffMs 10000, removeOnComplete false, removeOnFail 1000`. Enfileiramento: no `NfseWorkflowService`, logo após enfileirar `nfse-doc-prep`, em `try/catch` idêntico (falha apenas logada; o scheduler recupera). Recuperação: `DocsRecoveryScheduler` acrescenta `findAuthorizedWithoutReconciliation` e reenfileira (somente invoices que **têm** snapshot).

- [ ] **Step 1: Write failing tests**
  - `reconcile.spec.ts`: igual ⇒ `matched`; ISS `30.00` vs `30.01` ⇒ `within_tolerance`; `30.00` vs `31.00` ⇒ `divergent` com `delta '1.00'`; CBS local sem grupo `IBSCBS` na autorizada ⇒ `missing_in_authorized`; grupo na autorizada sem cálculo local ⇒ `missing_locally`; status final é o pior; números do SDK com representação binária (`0.1 + 0.2`) comparam corretamente via `Decimal`; MEI sem nenhum tributo e autorizada sem tributo ⇒ `matched`. Construa o `NFSe` do teste a partir de um XML real gerado por `buildDpsXml`+template do `FakeNfseProvider` **ou** de um `NFSe` literal tipado com os campos acima (use apenas campos existentes em `domain.d.ts`).
  - `fiscal-reconciliation.service.spec.ts`: grava uma linha, não altera snapshot/XML (assert: `storage.saveXml` e `snapshots.insert` nunca chamados), dispara webhook só em `divergent` e só uma vez (segunda execução ⇒ `insert` devolve `false` ⇒ sem webhook), métrica incrementada, sem snapshot ⇒ no-op.
  - processor: adquire lock, delega, libera; lock indisponível ⇒ lança (retry).
  - repo (Postgres): `insert` idempotente, `findAuthorizedWithoutReconciliation` só devolve `authorized` com snapshot e sem linha, RLS.
  - scheduler: reenfileira `nfse-fiscal-reconcile` para as pendentes; `queued` continua fora.
  - webhook: `PUBLIC_WEBHOOK_EVENT_TYPES` contém o novo tipo e `webhooks-config.controller.spec` aceita a assinatura.

- [ ] **Step 2: Run (FAIL) → implement → run (PASS)** — `MIGRATION_TEST_DATABASE_URL=… yarn jest src/modules/invoice src/modules/webhooks-config src/infra/database && yarn typecheck && yarn typecheck:tests`.

- [ ] **Step 3: Commit** — `git commit -m "feat(fiscal): reconcile authorized NFS-e values against the fiscal snapshot"`

---

## Task 9: Observabilidade, runbooks e verificação final

**Files:**
- Create: `docs/fiscal/runbooks/rtc-unavailable.md`, `docs/fiscal/runbooks/reconciliation-divergence.md`, `docs/fiscal/runbooks/dps-layout-unsupported.md`
- Create: `docs/fiscal/homologation.md`
- Modify: `docs/fiscal/limitations.md`, `api/FRONTEND_API.md`, `api/llms.txt`
- Test: suíte completa

- [ ] **Step 1: Métricas e logs.** Garanta presentes e com teste: `rtc_calculation_duration`, `rtc_calculation_failed_total{reason}`, `rtc_calculator_latency`, `dps_validation_failures_total` (incrementado pelo `DpsBuilder` consumer no workflow), `nfse_authorization_failures_total` (rejeições fiscais no `OpenNfseProvider`/workflow), `tax_reconciliation_mismatches_total`. Logs estruturados com `invoiceId`, `companyId`, `correlationId`, `errorCode`, `calculatorVersion`, `rulesVersion`, `layout` — nunca XML, PFX, senha ou documentos completos. Verifique por teste que o logger do adapter RTC não registra o corpo da requisição.

- [ ] **Step 2: Runbooks curtos** (sintoma → métrica/alerta → diagnóstico → ação) para: RTC indisponível (circuito aberto, `rtc_calculation_failed_total{reason}`), divergência de conciliação (`differences`, quando é arredondamento vs regra, como encaminhar à revisão fiscal), layout/DPS inválida (`DPS_LAYOUT_UNSUPPORTED`, como atualizar o SDK/XSD de forma controlada, nunca editar `node_modules`).

- [ ] **Step 3: `docs/fiscal/homologation.md`** — tabela com cenário, ambiente, data, versão da Calculadora, versão do `open-nfse`, resultado, evidência. Preencha **somente** o que foi de fato executado (contract tests da Task 3 contra a Calculadora; emissões de Produção Restrita se houver credenciais). Linhas não executadas ficam como `não executado`. Atualize `limitations.md` com: DPS sem `indFinal/tpOper/dest/imovel`, `vTotTrib` zerado, NT 009 não suportada, numeração consumida em rejeição de layout, E3 (tolerância) pendente, catálogos importados em data X.

- [ ] **Step 4: Documentação pública.** `FRONTEND_API.md`/`llms.txt`: novo webhook `nfse.invoice.fiscal_discrepancy` (payload), códigos `DPS_LAYOUT_UNSUPPORTED` e `DPS_SCHEMA_VALIDATION_FAILED` em `lastErrorCode`.

- [ ] **Step 5: Verificação final**
```bash
yarn lint:check
yarn typecheck && yarn typecheck:tests
yarn test --runInBand
MIGRATION_TEST_DATABASE_URL=postgres://…_test yarn jest postgres.integration
yarn test:fiscal:integration
yarn build && node scripts/verify-build-artifacts.mjs
docker compose -f deploy/docker-compose.yml config --quiet
```
Expected: tudo verde. Relate separadamente qualquer falha pré-existente.

- [ ] **Step 6: Commit** — `git commit -m "docs(fiscal): runbooks, homologation record and limitations"`

---

## Task 10: Vigilância de versão da Calculadora

A Calculadora tem versão do programa (`1.6.0`) e da base de dados (`V0059`), e o governo publica atualizações com frequência (o arquivo oficial foi substituído no mesmo endereço em 2026-10-14). Sem atualização, os valores divergem da Sefin e a conciliação acusa.

**Files:**
- Create: `.github/workflows/rtc-version-watch.yml`
- Modify: `deploy/README.md` (runbook "atualizar a Calculadora")
- Create: `docs/fiscal/runbooks/rtc-update.md`

- [ ] **Step 1: Workflow semanal** (uma única requisição por execução, por causa do WAF; falha de WAF vira aviso, não issue):
```yaml
name: rtc-version-watch
on:
  schedule: [{ cron: '0 12 * * 1' }]
  workflow_dispatch:
permissions:
  contents: read
  issues: write
jobs:
  watch:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Compare published and pinned versions
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          pinned="$(tr -d '[:space:]' < deploy/rtc-pinned-version.txt)"
          body="$(curl -fsS --retry 3 --retry-delay 30 -m 30             'https://piloto-cbs.tributos.gov.br/servico/calculadora-consumo/api/calculadora/dados-abertos/versao' || true)"
          published="$(printf '%s' "$body" | jq -r 'select(.versaoApp) | "\(.versaoApp)/\(.versaoDb)"' 2>/dev/null || true)"
          if [ -z "$published" ]; then
            echo "::warning::Could not read the published version (WAF or outage). Nothing was compared."
            exit 0
          fi
          if [ "$published" != "$pinned" ]; then
            title="Calculadora RTC: nova versão publicada ($published)"
            if ! gh issue list --state open --search "in:title \"$title\"" --json number -q '.[0].number' | grep -q .; then
              gh issue create --title "$title" \
                --body "Versão fixada: \`$pinned\`. Publicada: \`$published\`. Siga docs/fiscal/runbooks/rtc-update.md."
            fi
          fi
```
- [ ] **Step 2: Runbook** `docs/fiscal/runbooks/rtc-update.md`: (1) baixar o zip novo e calcular o SHA-256; (2) reconstruir a imagem com `RTC_ZIP_URL`/`RTC_ZIP_SHA256` e publicar com a tag `rtc-<versaoApp>-<versaoDb>`; (3) subir em staging e rodar `scripts/rtc-smoke.sh` e `RTC_CALCULATOR_URL=… yarn jest rtc-integration`; (4) recapturar as fixtures (README em `docs/fiscal/rtc`), revisar o diff do `expected` em PR; (5) atualizar `deploy/rtc-pinned-version.txt`, `docs/fiscal/rtc/ZIP_SHA256.txt` e `docs/fiscal/homologation.md`; (6) promover a imagem. Inclua o critério de rollback: voltar à tag anterior da imagem.
- [ ] **Step 3: Alerta em runtime.** No `HttpRtcCalculatorAdapter`, `version()` registra o gauge `greenflow.rtc.version_info` com atributo `version` e emite `warn` uma vez por hora se `versaoApp/versaoDb` ≠ `RTC_EXPECTED_VERSION` (env opcional, igual a `deploy/rtc-pinned-version.txt`). Teste: versão diferente ⇒ warn emitido uma vez no intervalo.
- [ ] **Step 4: Commit** — `git commit -m "chore(rtc): watch for new calculator versions"`
