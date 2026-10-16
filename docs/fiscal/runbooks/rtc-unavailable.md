# Runbook: Calculadora RTC indisponível

**Sintoma.** Notas de empresas do regime regular (com IBS/CBS obrigatório) ficam em `queued` e não avançam; no banco, mensagens `invoice.calculate-taxes` da outbox aparecem `pending` com `attempts` crescendo e `last_error` contendo `TAX_CALCULATION_UNAVAILABLE`. MEI e Simples não são afetados (não chamam a Calculadora).

**Como a Corvo reage (por desenho).**
- Rede, timeout, 5xx, 429, circuito aberto ou serviço ainda em partida ⇒ erro **retryable**: a invoice **não** é rejeitada; a outbox reentrega com backoff até `OUTBOX_MAX_ATTEMPTS` (padrão 10).
- Esgotadas as tentativas ⇒ a invoice é rejeitada com `TAX_CALCULATION_UNAVAILABLE`.
- Nenhuma DPS fiscalmente incompleta é emitida e nenhum valor é presumido.

**Métricas e logs.**
- `corvo.rtc.calculation.failed.total{reason}` com `reason` = `timeout | network | upstream_5xx | rate_limited | circuit_open`.
- `corvo.rtc.calculation.duration`, `corvo.rtc.request.duration`; gauge `corvo.rtc.version_info`.
- Mensagens `dead` na outbox: `corvo.outbox` (`corvo.outbox.dead.total`).

**Diagnóstico.**
1. Estado do serviço: `docker compose ps rtc-calculator` (healthcheck usa `GET /api/calculadora/dados-abertos/versao`).
2. Logs: `docker compose logs --tail=200 rtc-calculator`. A **partida leva ~4 minutos** (254 s medidos); `starting` não é falha. Memória em regime ~714 MiB (`mem_limit: 1536m`): um `OOMKilled` em `docker inspect` indica falta de memória.
3. Versão e resposta: `curl -s http://rtc-calculator:8080/api/calculadora/dados-abertos/versao` de dentro da rede, ou `sh api/scripts/rtc-smoke.sh`.
4. Circuito aberto: ele fecha sozinho após `RTC_CIRCUIT_RESET_MS` (30 s) se a sondagem seguinte tiver sucesso.

**Ação.**
- Serviço caído: reiniciar (`docker compose restart rtc-calculator`) e aguardar o healthcheck. As mensagens `pending` retomam sozinhas.
- Mensagens que chegaram a `dead` (tentativas esgotadas durante uma queda longa): depois de confirmar que a Calculadora voltou, reenfileirar **apenas** as `dead` do tipo `invoice.calculate-taxes` cuja invoice ainda esteja `queued`:
  ```sql
  -- executar como role de manutenção; revisar o SELECT antes do UPDATE
  SELECT o.id, o.aggregate_id, o.attempts, o.last_error
    FROM corvo.outbox_messages o
    JOIN corvo.nfse_invoices i ON i.id = o.aggregate_id
   WHERE o.type = 'invoice.calculate-taxes' AND o.status = 'dead' AND i.status = 'queued';
  UPDATE corvo.outbox_messages SET status = 'pending', attempts = 0, available_at = now(), lease_until = NULL
   WHERE id = ANY(ARRAY['<ids revisados>']::uuid[]);
  ```
- Queda prolongada e clientes impactados: avisar. O motor fiscal está sempre ligado (não há flag para desligá-lo); empresas MEI/Simples continuam emitindo normalmente porque não dependem da Calculadora.
- Competência ≥ 2027-01-01 no regime regular **não** é indisponibilidade: o motor exige alíquotas nominais que sua base ainda não tem (`TAX_RATE_NOT_FOUND`, não retryable). Ver `docs/fiscal/limitations.md`.
