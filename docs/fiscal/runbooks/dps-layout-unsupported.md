# Runbook: layout/DPS não suportado (`DPS_LAYOUT_UNSUPPORTED`, `DPS_SCHEMA_VALIDATION_FAILED`)

**Sintoma.** Invoice `rejected` com `lastErrorCode` `DPS_LAYOUT_UNSUPPORTED` ou `DPS_SCHEMA_VALIDATION_FAILED` e webhook `nfse.invoice.rejected`; métrica `corvo.fiscal.dps.validation.failed.total{code}`. Nenhuma transmissão à Sefin acontece nesses casos.

**O que cada código significa.**
- `DPS_LAYOUT_UNSUPPORTED`: o layout configurado em `FISCAL_DPS_LAYOUT` não está no registro de layouts implantados (`rtc-v1.01` e `nt009-r1` têm status `in_production`), ou está publicado mas ainda não implantado. O layout `nt009-r1` (NT 009 release 1, XSD de Produção Restrita 20261020) só é aceito com `NFSE_SEFIN_ENVIRONMENT=restricted`: a API não sobe com `FISCAL_DPS_LAYOUT=nt009-r1` apontando para produção, e o `DpsBuilder` recusa (`details.reason = restricted_environment_only`) uma nota `live` destinada à produção. Os códigos 99.02.01, 99.03.01 a 99.03.05 e 99.04.01 só existem nesse layout (`details.reason = layout_without_event` no layout atual). O leiaute 1.04.01 continua **não suportado**.
- `DPS_SCHEMA_VALIDATION_FAILED`: a DPS montada viola o XSD (campo exigido ausente ou inválido para o cenário). `details` traz as violações (limitadas, sem dados pessoais).

**Importante.** A numeração DPS já foi reservada e persistida antes da montagem; ao rejeitar, o número fica associado à invoice (nunca é devolvido à sequência, para não reutilizar numeração).

**Diagnóstico.**
1. Valor atual: `FISCAL_DPS_LAYOUT` no ambiente do worker e `deploy/` / `.env`.
2. Versão do SDK: `yarn why open-nfse` / `api/package.json` (esperado `0.11.0`, bundle XSD `20260727`).
3. Reproduzir a validação localmente com os dados do snapshot (`invoice_fiscal_snapshots.result`) usando `DpsBuilder` e `validateDpsXml` (ver `api/src/modules/invoice/domain/fiscal/dps/`).

**Ação.**
- Layout novo publicado pelo governo: **não** edite `node_modules` nem ignore a validação XSD. Atualize `open-nfse` de forma controlada (versão fixada), atualize o registro em `dps-layout.ts` somente quando o layout estiver `in_production`, rode `yarn test` e `yarn test:fiscal:integration` e só então altere `FISCAL_DPS_LAYOUT`.
- Violação de XSD por campo opcional não preenchido: o `DpsBuilder` não preenche por suposição. Levar o caso à revisão fiscal; a decisão sobre o dado vira regra no builder, com teste.
- Invoices já rejeitadas não são reprocessadas: o cliente cria uma nova invoice após a correção.

**Seleção por ambiente/data.** O padrão continua `FISCAL_DPS_LAYOUT=rtc-v1.01` (NT 004). A seleção explícita `nt009-r1` continua restrita a `NFSE_SEFIN_ENVIRONMENT=restricted`. Com `FISCAL_DPS_LAYOUT=auto`, Produção Restrita usa `nt009-r1`; produção usa `rtc-v1.01` até o instante `FISCAL_NT009_CUTOVER_AT` (ISO-8601 com offset; padrão `2026-12-01T00:00:00-03:00`). A partir desse instante, inclusive, produção só usa `nt009-r1` com `FISCAL_NT009_PRODUCTION_ENABLED=true` (padrão `false`). A decisão usa o `dhEmi` de cada DPS, inclusive em processos que atravessam a virada. Essa é a única exceção à recusa de NT 009 para notas live destinadas à produção. O XSD de produção NT 009 ainda não foi publicado; o opt-in deve ser habilitado somente após conferir a compatibilidade do pacote oficial.
