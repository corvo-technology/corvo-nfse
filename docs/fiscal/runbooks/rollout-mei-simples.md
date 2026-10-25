# Runbook: liberação gradual do foco em MEI e Simples Nacional

Spec: `docs/superpowers/specs/2026-10-25-mei-simples-focus-design.md` (seção 7.1).
Plano: `docs/superpowers/plans/2026-10-25-mei-simples-focus.md`.

Todas as mudanças nascem **desligadas**. Com tudo desligado a API se comporta como antes. As flags são lidas na subida do processo: depois de mudar o `.env` do deploy, **reinicie a API e o worker**. O worker é quem roda o motor fiscal e monta o DPS, então o `.env` dele precisa das mesmas variáveis.

## Flags

| Flag | Valores | O que liga |
|---|---|---|
| `FISCAL_DPS_CONFORMANCE` | `true`/`false` | Recusa dedução proibida (E0436, E0441, E0442) no `POST /invoices`, no cálculo e no lote; MEI sem retenção de ISS (E0583) |
| `TAX_REGIME_RESTRICTION` | `true`/`false` | Só MEI e Simples Nacional: cadastro e perfil fiscal recusam outros regimes (`422 ERROR_TAX_REGIME_NOT_SUPPORTED`); o motor deixa de calcular Lucro Presumido/Real (`TAX_REGIME_UNSUPPORTED`) |
| `SIMPLES_TOTTRIB` | `true`/`false` | Envia `indTotTrib`/`pTotTribSN` e o `regApTribSN` do perfil no lugar de zeros |
| `SIMPLES_RATE_MODE` | `off`/`warn`/`block` | Exigência da alíquota do Simples do mês |
| `SIMPLES_RATE_ENFORCED_FROM` | `YYYY-MM-DD` | Só exige a alíquota para competência a partir dessa data |
| `CNPJ_REGISTRY_CHECK` | `true`/`false` | Aviso de divergência com o cadastro público de CNPJ |

Cada flag aceita `<FLAG>_TENANTS` (UUIDs separados por vírgula, ou `*`) para liberar só para alguns tenants (canário). Vazio ou `*` vale para todos. Com a flag desligada, a lista não faz efeito.

## Ordem sugerida

1. `FISCAL_DPS_CONFORMANCE` (canário em um tenant, depois todos).
2. Auditoria de regimes (abaixo) e então `TAX_REGIME_RESTRICTION`.
3. `SIMPLES_TOTTRIB`, **depois** de os clientes ME/EPP terem informado a alíquota do mês.
4. `SIMPLES_RATE_MODE=warn`, depois `block` com `SIMPLES_RATE_ENFORCED_FROM`.
5. `CNPJ_REGISTRY_CHECK`.

Entre um passo e o próximo, deixe pelo menos um dia útil de emissões reais e confira as rejeições da Sefin.

## O que observar depois de cada passo

- Rejeições da Sefin nos códigos **E0436, E0441, E0442, E0583, E0600, E0534, E0160, E0041, E0710, E0712, E0162, E0166**. Um aumento depois de ligar uma flag é motivo para reverter.
- Respostas `422` novas: `ERROR_DEDUCTION_NOT_ALLOWED_FOR_REGIME`, `ERROR_TAX_REGIME_NOT_SUPPORTED`, `MISSING_CONFIGURATION` com `simplesRate.totalRate`.
- Notas em `queued` que não avançam (ver `rtc-unavailable.md` e `dps-layout-unsupported.md`).

## Como reverter

Desligue a flag no `.env` (da API e do worker) e reinicie os dois. Nada é apagado: as tabelas e colunas novas ficam, só o comportamento volta ao anterior. Para tirar apenas um cliente de um canário, retire o UUID de `<FLAG>_TENANTS`.

## Auditoria de regimes (antes de `TAX_REGIME_RESTRICTION`)

```bash
psql "$DATABASE_URL" -v app_schema=corvo -f api/scripts/audit-tax-regimes.sql
```

Lista toda empresa cujo perfil fiscal vigente ainda não é MEI nem Simples Nacional (inclusive `UNKNOWN`, que a migração usou para regimes não reconhecidos). Cada linha precisa ser corrigida à mão ou desativada **antes** de ligar a flag.

## Remoção das flags

Depois de uma flag ficar ligada para todos, sem incidentes, por um período combinado, remova a flag e o ramo antigo em um PR próprio e anote a data aqui:

| Flag | Ligada para todos em | Removida em |
|---|---|---|
| (preencher conforme as liberações) | | |
