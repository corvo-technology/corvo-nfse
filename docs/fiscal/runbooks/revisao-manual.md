# Runbook: nota em revisão manual (`manual_review`)

**Como chega aqui.** A emissão ou a reconciliação não teve resposta conclusiva do portal (timeout, erro de rede, fora do ar) por mais de `NFSE_UNCERTAIN_MAX_HOURS` (padrão 6 h) ou esgotou as 5 tentativas. A nota guarda o mesmo DPS (numeração nunca muda) e a reserva de crédito.

**Consulta automática (varredura).** A cada 30 minutos o worker (`ManualReviewSweepScheduler`) pergunta ao portal, por DPS (`GET /dps/{idDps}` na ADN), sobre as notas em `manual_review` dos dois ambientes e de todos os workspaces.
- Portal diz que o DPS foi autorizado: a nota vira `authorized` (chave, número, XML, crédito consumido, documentos, e-mail e webhooks como em qualquer reconciliação).
- Não encontrou, deu erro ou timeout: **nada muda**. A nota continua em revisão. A varredura nunca reenvia, nunca rejeita e nunca descarta.
- Limites: lote por rodada `MANUAL_REVIEW_SWEEP_BATCH` (50), ignora notas com mais de `MANUAL_REVIEW_SWEEP_MAX_AGE_DAYS` (30) dias, desligável com `MANUAL_REVIEW_SWEEP_ENABLED=false`.

**Logs.** Cada tentativa de reconciliação e cada checagem da varredura gera um log `Fiscal reconciliation attempt` com `invoiceId`, `dpsId`, `outcome` (`authorized`, `not_found`, `pending`, `rejected`, `timeout`, `error`, `manual_review`), `attempt`, `nextDelayMs`, `source` (`manual_review_sweep` na varredura) e um `reason` curto, sem XML. Procure por esse texto para saber o que o portal respondeu.

**O que fazer com notas que continuam em revisão.**
1. Veja os logs da nota. Se o portal responde `not_found` de forma consistente, o DPS provavelmente nunca foi registrado.
2. `POST /invoices/review` com `action: retry` (reenvia com o mesmo DPS; o provedor consulta o portal antes de enviar, então não duplica) ou `action: discard` (só rejeita e devolve o crédito se o portal confirmar que o DPS nunca existiu).
3. Nunca crie outra nota para o mesmo serviço antes de resolver esta.
