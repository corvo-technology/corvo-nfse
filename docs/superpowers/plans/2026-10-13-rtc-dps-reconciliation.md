# Calculadora RTC real, DpsBuilder e conciliação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar o `UnconfiguredRtcCalculator` por um adapter HTTP da Calculadora RTC oficial (rede privada), montar a DPS completa (incluindo o grupo `IBSCBS`) a partir do snapshot fiscal, emiti-la preservando numeração/idempotência/retry, e conciliar o que a engine calculou com a NFS-e autorizada sem alterar o XML.

**Architecture:** `HttpRtcCalculatorAdapter` implementa o `RtcCalculatorPort` do plano 2; o contrato HTTP real é descoberto e fixado em fixtures na Task 1. `DpsBuilder` (domínio puro + tipos do `open-nfse`) converte `FiscalCalculationResult` em `DPS`; o `OpenNfseProvider` assina a DPS pronta via `emitirDpsPronta(dps, { dryRun: true })` e segue o fluxo atual (pending → `replayPendingEvents`). Após `authorized`, um job BullMQ `nfse-fiscal-reconcile` compara os valores do XML autorizado com o snapshot e grava `invoice_fiscal_reconciliations`.

**Tech Stack:** NestJS 11, TypeORM/PostgreSQL (RLS), BullMQ, `open-nfse` 0.11.0 (layout RTC v1.01), Jest (unit com SDK real via bridge nativo), Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-13-rtc-dps-reconciliation-design.md` (depende dos planos `outbox-intake-schedule` e `fiscal-engine-core` já executados).

## Global Constraints

- Trabalhar em `api/` e `deploy/`; branch `feat/rtc-dps-reconciliation` (nunca na `main`).
- Caminhos com prefixo `api/`, `docs/` ou `deploy/` são relativos à **raiz do repositório**; todos os demais (`src/`, `test/`, `scripts/`, `nest-cli.json`) são relativos a `api/`. Comandos `yarn` rodam em `api/`.
- **Nada de endpoint, campo ou schema da Calculadora é escrito de memória.** Tudo vem do OpenAPI/respostas capturados na Task 1 e salvos em `docs/fiscal/rtc/`. A API pública de demonstração não é dependência de produção; só o artefato oficial offline em rede privada.
- Sem `any`; falhas esperadas são `Result<_, FiscalError>`; erros de SDK/HTTP nunca saem do adapter.
- Layout ativo por ambiente: `FISCAL_DPS_LAYOUT` (padrão `rtc-v1.01`). Layout publicado mas não implantado e NT 009/V1.04.00 ⇒ `DPS_LAYOUT_UNSUPPORTED`. Nada de XML presumido, nada de editar `node_modules`, XSD nunca ignorado (`skipValidation` proibido).
- Timeout após transmissão ⇒ resultado indeterminado: consultar (`fetchDpsStatus`/`fetchByChave`) antes de qualquer reenvio; nunca reservar nova numeração para a mesma invoice.
- Certificado A1, PFX e senha nunca em log/telemetria; XML completo nunca em log.
- Unit tests rodam com `open-nfse` mapeado para `test/__mocks__/open-nfse.ts` (que **re-exporta o SDK real** de um subconjunto de símbolos). Todo símbolo novo usado em unit tests deve ser acrescentado a esse mock. Testes de emissão com `NfseClientFake` real rodam em `jest-fiscal.json`.
- Nenhuma emissão em produção em testes. Produção Restrita só manual/opcional com credenciais, e só o que for efetivamente executado vira "homologado" em `docs/fiscal/homologation.md`.
- Migrations após `1791810000000`; RLS idêntica às existentes; novas tabelas em `TENANT_RLS_TABLES`.

## Review Focus

- RTC fora do ar / lento / 5xx ⇒ erro retryable e **nenhuma** DPS emitida sem o grupo exigido (Task 2, 6).
- Resposta do motor com tipos errados, campos ausentes ou valores negativos ⇒ erro de cálculo não retryable, nunca valor presumido (Task 3).
- Timeout durante o POST: a mesma invoice nunca ganha segunda numeração nem segunda DPS (Task 7).
- 429 com `Retry-After` respeitado (Task 7).
- DPS sem tomador, com desconto, com ISS retido, com CNPJ alfanumérico (Task 5).
- Layout não implantado/NT 009 bloqueia com erro explícito antes de assinar (Task 6).
- Divergência de 1 centavo (arredondamento) não vira alarme; divergência material sim; XML autorizado intacto (Task 8).
- Nota autorizada sem grupo IBS/CBS (tolerância da Sefin) é registrada como `missing_in_authorized`, não como "ok" (Task 8).
- Reconciliação duplicada (job reentregue) não cria segunda linha (Task 8).

---

## Task 1: Descoberta do contrato da Calculadora e implantação interna

**Files:**
- Create: `docs/fiscal/rtc/README.md`, `docs/fiscal/rtc/openapi.json`, `docs/fiscal/rtc/fixtures/*.json`
- Modify: `deploy/docker-compose.yml`, `deploy/docker-compose.local.yml`, `api/.env.example`, `api/src/infra/config/env.schema.ts`, `configuration.ts`, `configuration.types.ts`
- Test: `api/src/infra/config/rtc-env.spec.ts`

Esta task é de **descoberta + configuração**; não escreve lógica de negócio. O código das Tasks 2–3 depende do que ela registrar.

- [ ] **Step 1: Obter o artefato oficial offline.** Em `https://consumo.tributos.gov.br/servico/calcular-tributos-consumo/calculadora/documentacao` (página renderizada por JavaScript — abra em navegador) localize a distribuição offline da Calculadora (imagem de contêiner, jar ou binário), sua **versão**, licença/termos de uso e instruções de execução. Registre em `docs/fiscal/rtc/README.md`: URL de download, versão, checksum/digest, requisitos (JVM/porta/variáveis), e a data da consulta. Se a distribuição offline não existir ou os termos proibirem uso em produção, **pare** e leve ao responsável pelo produto: o restante do plano depende dessa decisão (spec 3, E1).

- [ ] **Step 2: Subir localmente e salvar o contrato real.** Execute o artefato em uma porta local, baixe o OpenAPI/Swagger que **a própria instância** serve (a UI está em `…/api/swagger-ui/index.html`; o JSON costuma estar em `…/api/v3/api-docs` na instância — confirme o caminho real) e salve em `docs/fiscal/rtc/openapi.json`. Liste em `README.md`, a partir do JSON salvo, os endpoints efetivamente existentes para: cálculo regime geral, base de cálculo NFS-e, consulta de situação tributária/classificações (CST/cClassTrib), NBS, indicador de operação (cIndOp), local, e versão dos dados abertos. **Somente os endpoints listados aqui poderão ser usados nas próximas tasks.**

- [ ] **Step 3: Capturar fixtures reais.** Para cada cenário abaixo, monte a requisição a partir do OpenAPI salvo, chame a instância local e salve `{ request, response, calculatorVersion, capturedAt }` em `docs/fiscal/rtc/fixtures/<cenario>.json` (códigos de classificação **reais**, extraídos das consultas de catálogo da própria Calculadora, nunca inventados):
  1. serviço de consultoria (`010601`) para PJ, competência `2026-12-10`, base R$ 1000,00 (regime regular);
  2. mesmo serviço, competência `2027-03-10`;
  3. um serviço/classificação com redução de alíquota, **se existir** nos catálogos (registre qual e por quê);
  4. com desconto incondicional R$ 100,00;
  5. requisição inválida (campo obrigatório ausente) — captura o formato de erro de validação;
  6. classificação inexistente — captura o formato de erro fiscal.
  Anote em `README.md` quais campos da resposta correspondem a: base IBS/CBS, alíquota nominal/efetiva/redução de CBS e de IBS-UF/IBS-Mun, valores, diferimento, fundamentação legal e memória de cálculo.

- [ ] **Step 4: Configuração e compose.** Acrescente ao `env.schema.ts` (zod): `RTC_CALCULATOR_URL` (url, opcional), `RTC_CALCULATOR_TIMEOUT_MS` (padrão 8000), `RTC_CALCULATOR_MAX_CONCURRENCY` (padrão 8), `RTC_CIRCUIT_FAILURE_THRESHOLD` (padrão 5), `RTC_CIRCUIT_RESET_MS` (padrão 30000), `FISCAL_DPS_LAYOUT` (enum `rtc-v1.01`, padrão `rtc-v1.01`); ao `configuration.ts`/`types` uma seção `rtc` com esses campos. Em `deploy/docker-compose.yml`, adicione o serviço `rtc-calculator` **sem `ports`** (apenas rede interna do compose), com imagem/artefato fixado por digest conforme o Step 1, `restart: unless-stopped` e `healthcheck` apontando para o endpoint de saúde/versão descoberto; adicione `RTC_CALCULATOR_URL: http://rtc-calculator:<porta>` ao `x-backend` e `depends_on` de saúde para `api`/`worker`. Espelhe no `docker-compose.local.yml` e em `api/.env.example`.

- [ ] **Step 5: Test + commit.** Teste `rtc-env.spec.ts` (padrão do `outbox-env.spec.ts`): defaults e coerção. `yarn jest src/infra/config && yarn typecheck && docker compose -f deploy/docker-compose.yml config --quiet` (com as variáveis exigidas). Commit: `git add docs/fiscal deploy api && git commit -m "chore(rtc): record calculator contract and add private service config"`.

---

## Task 2: HttpRtcCalculatorAdapter — transporte, erros, resiliência

**Files:**
- Create: `src/modules/invoice/infra/fiscal/rtc/http-rtc-calculator.adapter.ts`
- Create: `src/modules/invoice/infra/fiscal/rtc/rtc-http-client.ts`
- Create: `src/modules/invoice/infra/fiscal/rtc/circuit-breaker.ts`
- Create: `src/modules/invoice/infra/fiscal/rtc/rtc-mapper.ts` (somente a interface; implementação na Task 3)
- Modify: `src/modules/invoice/invoice.module.ts` (provider `RtcCalculatorPort`: `HttpRtcCalculatorAdapter` quando `RTC_CALCULATOR_URL` existe, senão `UnconfiguredRtcCalculator`)
- Create: `src/modules/invoice/infra/fiscal/rtc/rtc.metrics.ts`
- Test: `circuit-breaker.spec.ts`, `http-rtc-calculator.adapter.spec.ts` (servidor HTTP local de teste)

**Interfaces:**
- Consumes: `RtcCalculatorPort`, `RtcCalculationInput`, `RtcTaxResult`, `fiscalError` (plano 2); `RtcConfig` (Task 1).
- Produces:
  ```ts
  // rtc-mapper.ts
  export interface RtcMapper {
    toRequest(input: RtcCalculationInput): { path: string; method: 'POST' | 'GET'; body?: unknown };
    fromResponse(body: unknown, input: RtcCalculationInput, calculatorVersion: string): Result<RtcTaxResult, FiscalError>;
    fromErrorBody(status: number, body: unknown): FiscalError | null;   // 4xx fiscal/validation error → typed error; null = unknown shape
  }
  // circuit-breaker.ts
  export class CircuitBreaker { constructor(opts: { failureThreshold: number; resetMs: number; now?: () => number }); canPass(): boolean; onSuccess(): void; onFailure(): void; readonly state: 'closed' | 'open' | 'half-open' }
  // http-rtc-calculator.adapter.ts
  export class HttpRtcCalculatorAdapter extends RtcCalculatorPort { constructor(config: RtcConfig, mapper: RtcMapper, http?: typeof fetch) }
  ```
  Mapeamento de falhas (fixo, independente do schema): rede/abort/timeout ⇒ `TAX_CALCULATION_UNAVAILABLE`, `INTEGRATION`, `retryable: true`, `details.reason 'timeout'|'network'`; HTTP 5xx ⇒ idem `reason 'upstream_5xx'`; HTTP 429 ⇒ idem `reason 'rate_limited'` com `details.retryAfterMs` (de `Retry-After`); circuito aberto ⇒ `TAX_CALCULATION_UNAVAILABLE` retryable `reason 'circuit_open'` **sem chamar a rede**; HTTP 4xx ⇒ `mapper.fromErrorBody`; se `null` ⇒ `TAX_CALCULATION_UNSUPPORTED` (`UNSUPPORTED`, `details.status`); corpo 2xx que não é JSON ⇒ `FISCAL_VALIDATION_FAILED` `rtc_invalid_response` (não retryable); 2xx válido ⇒ `mapper.fromResponse`. A versão do motor vem do endpoint de versão descoberto na Task 1 (cache em memória por 60 s) e é passada a `fromResponse`.

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
it('a success resets the failure count', () => { /* 2 failures, success, 2 failures → still closed */ });
it('reopens when the half-open probe fails', () => { /* … */ });
```

`http-rtc-calculator.adapter.spec.ts` — sobe um `http.createServer` local por teste (porta efêmera) e um mapper fake (`toRequest` → `{ path: '/calc', method: 'POST', body }`, `fromResponse` → ok com resultado fixo):
```ts
it('returns the mapped result on 200', ...);
it('maps a timeout to a retryable TAX_CALCULATION_UNAVAILABLE', ...);   // servidor nunca responde; timeoutMs 50
it('maps 503 to a retryable error', ...);
it('maps 429 with Retry-After to retryAfterMs', ...);                   // header 'retry-after: 2' → 2000
it('opens the circuit after the threshold and then does not call the network', ...); // contador de requests no servidor
it('maps an unknown 4xx to TAX_CALCULATION_UNSUPPORTED', ...);
it('uses the mapper for a known 4xx fiscal error', ...);
it('rejects a non-JSON 200 body as rtc_invalid_response (not retryable)', ...);
it('never forwards raw SDK/HTTP errors (all failures are FiscalError)', ...);
it('limits concurrency to RTC_CALCULATOR_MAX_CONCURRENCY', ...);        // 20 chamadas, servidor mede pico ≤ limite
it('health() reflects reachability and version() reads the version endpoint', ...);
```

- [ ] **Step 2: Run to verify they fail** — `yarn jest src/modules/invoice/infra/fiscal/rtc` → FAIL.

- [ ] **Step 3: Implement**

`circuit-breaker.ts`:
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

`rtc-http-client.ts`: pequena classe `RtcHttpClient` com `request({ path, method, body })` que aplica `AbortController` com `timeoutMs`, semáforo de concorrência (fila em memória), `fetch` injetável, e devolve `{ status, headers, text }` ou lança `RtcTransportError('timeout' | 'network')` (classe local, nunca exportada para fora do adapter).

`http-rtc-calculator.adapter.ts`: orquestra `breaker.canPass()` → `http.request` → classificação conforme **Mapeamento de falhas**; `onFailure` para timeout/rede/5xx/429, `onSuccess` para 2xx e 4xx (o motor respondeu). `health()` chama o endpoint de versão/saúde descoberto; `version()` idem com cache de 60 s. Métricas (`rtc.metrics.ts`, meter `greenflow.rtc`): `rtc_calculation_duration` (histograma, atributo `outcome`), `rtc_calculation_failed_total{reason}`, `rtc_calculator_latency`.

Wiring no `invoice.module.ts`:
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
com `RTC_MAPPER` provendo o `DefaultRtcMapper` da Task 3 (nesta task, provider temporário que lança `Error('RtcMapper is implemented in Task 3')` **apenas se chamado** é inaceitável como entrega final — por isso as Tasks 2 e 3 são mergeadas juntas; mantenha o provider apontando para uma classe com `toRequest`/`fromResponse`/`fromErrorBody` lançando `Error('not implemented')` somente até a Task 3 e não faça deploy entre elas).

- [ ] **Step 4: Run to verify they pass** — `yarn jest src/modules/invoice/infra/fiscal/rtc && yarn typecheck` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(rtc): add HTTP calculator adapter with timeout, circuit breaker and error mapping"`

---

## Task 3: Mapper do contrato oficial (golden fixtures)

**Files:**
- Create: `src/modules/invoice/infra/fiscal/rtc/default-rtc-mapper.ts`
- Create: `src/modules/invoice/infra/fiscal/rtc/default-rtc-mapper.spec.ts`
- Modify: `src/modules/invoice/domain/fiscal/rtc/rtc-calculator.port.ts` (somente se o contrato exigir campo extra em `RtcCalculationInput`; documente a razão)

**Interfaces:**
- Consumes: `RtcMapper` (Task 2), fixtures de `docs/fiscal/rtc/fixtures/*.json`, `assertRtcResultConsistent` (plano 2, Task 13).
- Produces: `DefaultRtcMapper implements RtcMapper` — única classe que conhece nomes de campos do motor.

Esta task é **orientada por fixtures**: o conteúdo de `toRequest`/`fromResponse`/`fromErrorBody` é determinado pelos arquivos capturados na Task 1.

- [ ] **Step 1: Write the golden-file tests** (estrutura fixa; os valores esperados saem das fixtures):

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DefaultRtcMapper } from './default-rtc-mapper';

const dir = join(process.cwd(), '..', 'docs/fiscal/rtc/fixtures');
const load = (name: string) => JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8')) as {
  request: unknown; response: unknown; calculatorVersion: string; input: RtcCalculationInput; expected?: RtcTaxResult; expectedError?: { code: string; category: string };
};

describe('DefaultRtcMapper (golden fixtures)', () => {
  const mapper = new DefaultRtcMapper();

  it.each(readdirSync(dir).filter((f) => f.startsWith('ok-')).map((f) => f.replace('.json', '')))(
    '%s: request matches the captured request and response maps to the typed result', (name) => {
      const f = load(name);
      expect(mapper.toRequest(f.input).body).toEqual(f.request);
      const result = mapper.fromResponse(f.response, f.input, f.calculatorVersion);
      expect(result).toEqual({ ok: true, value: f.expected });
    });

  it('error fixtures map to typed fiscal errors', () => {
    for (const name of readdirSync(dir).filter((f) => f.startsWith('error-')).map((f) => f.replace('.json', ''))) {
      const f = load(name);
      const err = mapper.fromErrorBody(400, f.response);
      expect(err).toMatchObject({ code: f.expectedError!.code, category: f.expectedError!.category, retryable: false });
    }
  });

  it('rejects a response missing required components with a non-retryable calculation error', () => {
    const f = load('ok-consultoria-2026');
    const broken = JSON.parse(JSON.stringify(f.response));
    // delete the field the fixture README maps to the CBS amount (see docs/fiscal/rtc/README.md)
    deleteAtPath(broken, CBS_AMOUNT_PATH);
    expect(mapper.fromResponse(broken, f.input, f.calculatorVersion)).toMatchObject({ ok: false, error: { category: 'CALCULATION', retryable: false } });
  });

  it('rejects wrong types (string where a number is expected) and negative amounts', () => { /* mutate fixture at the mapped paths */ });
  it('preserves legal references and the calculation memory from the response', () => { /* expected.legalReferences / calculationMemory non-empty when present in the fixture */ });
  it('keeps monetary values as decimal strings without float drift', () => { /* e.g. 0.1+0.2 style value in a crafted body */ });
});
```
Antes de rodar, complete cada fixture com `input` (o `RtcCalculationInput` usado) e `expected` (o `RtcTaxResult` esperado, escrito **à mão a partir da resposta capturada**, conferindo cada número contra o README da Task 1). `CBS_AMOUNT_PATH` e `deleteAtPath` são helpers locais do spec.

- [ ] **Step 2: Run to verify they fail** → FAIL.

- [ ] **Step 3: Implement `DefaultRtcMapper`**: `toRequest` monta o corpo exatamente como na fixture (datas, valores em string/number conforme o OpenAPI; converta `DecimalString` → tipo exigido **sem passar por `number`** quando o motor aceitar string; se exigir `number`, converta com `Decimal#toNumber()` apenas na borda e documente). `fromResponse` extrai base/alíquotas/valores/reduções/diferimentos/fundamentação/memória, converte tudo para `DecimalString` via `toDecimal(...)`, valida tipos (qualquer campo obrigatório ausente ou de tipo errado ⇒ `fiscalError({ code: 'FISCAL_VALIDATION_FAILED', category: 'CALCULATION', details: { reason: 'rtc_invalid_response', path } })`), compõe `ibsTotal = ibsState + ibsCity` **somente se** o motor não o fornecer, e chama `assertRtcResultConsistent(result, input.grossAmount)`. `collectionWaived` vem do motor se informado; caso contrário `false`. `fromErrorBody` classifica por código/mensagem do formato capturado: validação de entrada ⇒ `FISCAL_VALIDATION_FAILED` (`VALIDATION`); classificação/local inexistente ⇒ `FISCAL_CLASSIFICATION_INVALID` (`CLASSIFICATION`); desconhecido ⇒ `null`.

- [ ] **Step 4: Run to verify they pass** — `yarn jest src/modules/invoice/infra/fiscal/rtc && yarn typecheck` → PASS. Rode também os testes do plano 2 que usam `RtcCalculatorPort` (`yarn jest src/modules/invoice`).

- [ ] **Step 5: Contract test contra a instância real (opcional/etiquetado).** Crie `src/modules/invoice/infra/fiscal/rtc/rtc-contract.rtc-integration.spec.ts`, `describe.skip` sem `RTC_CALCULATOR_URL`; com a variável, executa cada fixture `ok-*` contra a Calculadora local e compara o `expected` (valores devem coincidir com a captura da mesma versão). Documente em `docs/fiscal/rtc/README.md` como rodar (`RTC_CALCULATOR_URL=http://localhost:<porta> yarn jest rtc-integration`). Registre em `docs/fiscal/homologation.md` a data e a versão do motor contra a qual passou.

- [ ] **Step 6: Commit** — `git commit -m "feat(rtc): map the official calculator contract with golden fixtures"`

---

## Task 4: Catálogos NBS / CST / cClassTrib / cIndOp

**Files:**
- Create: `scripts/build-rtc-catalogs.ts`
- Create: `src/modules/invoice/infra/fiscal/catalog/{nbs,cst,cclasstrib,cindop}.json` (gerados)
- Modify: `src/modules/invoice/domain/fiscal/classification/ctribnac-catalog.ts` → renomear para `json-fiscal-catalog.ts` (mantenha re-export)
- Test: `json-fiscal-catalog.spec.ts` (estende o spec do plano 2)

**Interfaces:**
- Consumes: endpoints de catálogo registrados na Task 1 (README); `IFiscalCatalog.validateClassification`.
- Produces: `JsonFiscalCatalog` constrói-se com `{ ctribnac, nbs?, cst?, cclasstrib?, cindop?, relations? }`; `validateClassification` passa a devolver `validated | invalid | ambiguous` quando os catálogos correspondentes estão carregados.

Relações a validar (somente as que o catálogo oficial expressa): `cClassTrib` existe e é compatível com o `CST` informado; `cIndOp` existe; `nbsCode` existe; (se o catálogo trouxer correlação `cTribNac → NBS` ou `NBS → cClassTrib`, valide-a; **se houver mais de uma possibilidade e nada informado ⇒ `ambiguous` com `candidates`**). Vigência: cada entrada tem `validFrom/validUntil` quando o motor as fornece; a validação usa a data da competência.

- [ ] **Step 1: Script.** `scripts/build-rtc-catalogs.ts` chama **apenas** os endpoints de catálogo documentados na Task 1 contra `--url` (a instância local), pagina se necessário, e grava cada JSON com `{ kind, version, sourceUrl, publishedAt, checksum, entries }` (checksum = sha256 do corpo bruto concatenado; `version` = versão dos dados abertos informada pelo motor, nunca inventada). Execute e revise o diff do JSON no PR.

- [ ] **Step 2: Write failing tests** em `json-fiscal-catalog.spec.ts` usando **trechos reais** dos JSON gerados (carregue o arquivo e escolha entradas existentes programaticamente: `entries[0]`, uma entrada de `cclasstrib` com CST compatível etc. — nada de códigos digitados à mão):

```ts
it('validates a CST/cClassTrib pair that exists in the official catalog', ...);
it('rejects a cClassTrib incompatible with the CST', ...);              // pega um cClassTrib e um CST de outra família
it('rejects an unknown NBS / cIndOp', ...);
it('honors validity dates of catalog entries (competence date)', ...);
it('returns ambiguous with candidates when the catalog maps one service to several classifications and none was informed', ...);
it('reports the loaded catalog versions in the result', ...);
it('stays "unavailable" for kinds whose files are not loaded', ...);
```

- [ ] **Step 3: Run (FAIL) → implement → run (PASS)** — `yarn jest src/modules/invoice/domain/fiscal/classification && yarn typecheck`.

- [ ] **Step 4: Atualizar o classificador do plano 2.** Com catálogos carregados, `catalogValidated` passa a `true` nos casos `validated`; os testes do `classify-service` e do `TaxApplicabilityStep` que usavam `catalogValidated: false` por indisponibilidade devem continuar passando (fake) e ganhar um caso com o catálogo real. Garanta que `nest-cli.json > assets` copia os quatro novos JSON (`yarn build && ls dist/modules/invoice/infra/fiscal/catalog`).

- [ ] **Step 5: Commit** — `git commit -m "feat(fiscal): validate NBS, CST, cClassTrib and cIndOp against official catalogs"`

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
