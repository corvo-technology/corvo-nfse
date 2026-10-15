# Runbook: divergência de conciliação fiscal

**Contexto.** Depois que uma nota é `authorized`, o job `nfse-fiscal-reconcile` compara os valores que a engine calculou (snapshot) com os que a Sefin consolidou na NFS-e autorizada e grava uma linha em `corvo.invoice_fiscal_reconciliations`. Isso **nunca** altera o snapshot, o XML autorizado nem o status da invoice.

**Sintoma.** Webhook `nfse.invoice.fiscal_discrepancy` para o tenant, métrica `tax_reconciliation_mismatches_total` e linha com `status = 'divergent'`.

**Estados.**
| `status` | Significado | Ação |
|---|---|---|
| `matched` | Todos os valores comparáveis são iguais | Nenhuma |
| `within_tolerance` | Diferença ≤ tolerância (R$ 0,01 por tributo; regra `reconciliation.tolerance`, pendente de confirmação fiscal E3) | Nenhuma; acompanhar tendência |
| `divergent` | Diferença maior que a tolerância, ou grupo presente só de um lado | Investigar |

**Diagnóstico.**
```sql
SELECT status, differences, local_values, authorized_values, tolerance_absolute, rules_version, reconciled_at
  FROM corvo.invoice_fiscal_reconciliations WHERE invoice_id = '<id>';
```
`differences` lista `{ field, local, authorized, delta, kind }`:
- `kind = 'amount'` com `delta` de poucos centavos em vários tributos ⇒ provável regra de arredondamento da Sefin. Registrar o padrão (campo, valores, regime) e levar à revisão fiscal para ajustar a tolerância/arredondamento; **não** editar valores.
- `kind = 'missing_in_authorized'` ⇒ a engine calculou IBS/CBS/ISS, mas a nota autorizada não traz o grupo. Em 2026 a Sefin tolera DPS sem o grupo; confirmar se a DPS enviada continha `IBSCBS` e se o `FISCAL_DPS_LAYOUT` estava correto.
- `kind = 'missing_locally'` ⇒ a Sefin consolidou valores que a engine não calculou (ex.: cálculo não executado). Verificar a aplicabilidade no snapshot (`trace`, `applicability`) e a versão da Calculadora (`calculatorVersion`).
- Diferença grande de valor ⇒ comparar a versão da Calculadora do snapshot (`calculatorVersion`, `catalogVersions`) com a vigente; uma Calculadora desatualizada gera divergências sistemáticas (ver `rtc-update.md`).

**Ação.** A divergência é uma **revisão fiscal**, não um erro operacional: encaminhar o caso (invoice, snapshot, XML autorizado e a linha de conciliação) ao responsável fiscal/contador. Nunca reescrever o XML autorizado nem o snapshot. Se a nota estiver incorreta, o caminho é a regra fiscal (substituição/cancelamento), fora do escopo deste runbook.

**Reprocessar.** O job é idempotente por `invoice_id` (uma única linha). Se o job falhou sem linha, o `DocsRecoveryScheduler` reenfileira automaticamente as notas `authorized` com snapshot e sem conciliação.
