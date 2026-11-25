# Runbook: nota em revisão manual (`manual_review`)

**Como chega aqui.** A emissão ou a reconciliação não teve resposta conclusiva do portal (timeout, erro de rede, fora do ar) por mais de `NFSE_UNCERTAIN_MAX_HOURS` (padrão 6 h) ou esgotou as 5 tentativas. A nota guarda o mesmo DPS (numeração nunca muda) e a reserva de crédito.

**Consulta automática (varredura).** A cada 30 minutos o worker (`ManualReviewSweepScheduler`) pergunta ao portal, por DPS (`GET /dps/{idDps}` na ADN), sobre as notas em `manual_review` dos dois ambientes e de todos os workspaces.
- Portal diz que o DPS foi autorizado: a nota vira `authorized` (chave, número, XML, crédito consumido, documentos, e-mail e webhooks como em qualquer reconciliação).
- Não encontrou, deu erro ou timeout: **nada muda**. A nota continua em revisão. A varredura nunca reenvia, nunca rejeita e nunca descarta.
- Limites: lote por rodada `MANUAL_REVIEW_SWEEP_BATCH` (50), ignora notas com mais de `MANUAL_REVIEW_SWEEP_MAX_AGE_DAYS` (30) dias, desligável com `MANUAL_REVIEW_SWEEP_ENABLED=false`.

**Conferência da nota do portal.** O portal responde pelo id do DPS (CNPJ + série + número). Se esse número já foi usado por outra emissão (outro sistema, o Emissor Nacional, outra instalação do Corvo, a empresa cadastrada de novo), o portal devolve a OUTRA nota. Por isso, antes de aceitar qualquer nota do portal (resposta da emissão, reconciliação, varredura, descarte), o Corvo confere CNPJ do prestador, documento do tomador, valor do serviço (`vServ`), competência (`dCompet`) e série/número do DPS. Se algo diverge:
- a nota NÃO é autorizada, o XML não é guardado e nenhum e-mail sai;
- a nota vai (ou fica) em `manual_review` com o código `DPS_NUMBER_USED_BY_OTHER_NFSE` e uma mensagem que diz qual é a outra nota (número, data e valor);
- a varredura não pergunta de novo por ela; "Tentar de novo" é recusado (`reason: dps_used_by_other_nfse`), porque o mesmo número seria recusado (E0014) ou traria a outra nota de novo;
- "Descartar" consulta o portal, confirma que o DPS é de outra nota e marca esta como `rejected` (crédito devolvido), mantendo o código.
- Depois, a venda é emitida de novo como uma nota nova ("Duplicar" no painel ou `nfse_repeat` no MCP), que recebe outro número. Antes, confira "Numeração das notas" na página da empresa: o Corvo nunca muda a numeração sozinho.
- Uma nota que não dá para ler fica em revisão com `PORTAL_NFSE_UNVERIFIED` (fale com o suporte).

**Logs.** Cada tentativa de reconciliação e cada checagem da varredura gera um log `Fiscal reconciliation attempt` com `invoiceId`, `dpsId`, `outcome` (`authorized`, `not_found`, `pending`, `rejected`, `timeout`, `error`, `manual_review`), `attempt`, `nextDelayMs`, `source` (`manual_review_sweep` na varredura) e um `reason` curto, sem XML. Procure por esse texto para saber o que o portal respondeu.

**O que fazer com notas que continuam em revisão.**
1. Veja os logs da nota. Se o portal responde `not_found` de forma consistente, o DPS provavelmente nunca foi registrado.
2. `POST /invoices/review` com `action: retry` (reenvia com o mesmo DPS; o provedor consulta o portal antes de enviar, então não duplica) ou `action: discard` (só rejeita e devolve o crédito se o portal confirmar que o DPS nunca existiu).
3. Nunca crie outra nota para o mesmo serviço antes de resolver esta.
