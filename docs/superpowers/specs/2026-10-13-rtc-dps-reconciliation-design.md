# Spec 3 — Calculadora RTC real, DpsBuilder e conciliação

Data: 2026-10-13 · Status: rascunho para revisão · Depende de: Specs 1 e 2 · Escopo: `api/`, `deploy/`

Cobre as seções 11 (adapter), 15, 16 e a parte de conciliação do briefing.

## 1. Objetivo

1. Substituir o `UnconfiguredRtcCalculator` por um adapter HTTP real da Calculadora de Tributos oficial, executada em rede privada.
2. Montar a DPS completa, incluindo o grupo `IBSCBS`, e emiti-la preservando as garantias atuais (numeração, idempotência, retry, reconciliação).
3. Conciliar o que a engine calculou com o que a Sefin consolidou na NFS-e autorizada, sem sobrescrever o XML autorizado.

## 2. Fatos verificados e lacunas

Verificado em `open-nfse` 0.11.0 (instalado):
- Leiaute RTC v1.01 (bundle XSD 20260727), CNPJ alfanumérico em produção desde 10/08/2026; a NT 009/2026 (V1.04.00) está **adiada** segundo o README da lib.
- `InfDPS.IBSCBS` (`RtcInfoIbsCbs`) é **declaratório**: `finNFSe`, `indFinal?`, `cIndOp`, `tpOper?`, `gRefNFSe?`, `tpEnteGov?`, `indDest`, `dest?`, `imovel?`, `valores.trib.gIBSCBS` (situação e classificação: CST, cClassTrib) e diferimentos opcionais. Não há campos de valor calculado de CBS/IBS que a Corvo deva preencher; os valores são consolidados pela Sefin.
- `emitir(params)` exige `DpsCounter` e `RetryStore`; a própria lib orienta **`emitirDpsPronta(dps)`** para cenários avançados (incluindo IBSCBS) e este **não usa** `DpsCounter`.
- A Corvo hoje usa `emitir(..., dryRun)` + `RetryStore` próprio (`OpenNfseProvider`) e sequência DPS própria (`DPS_SEQUENCE_REPOSITORY`).

**Verificado em 2026-10-15 na própria Calculadora (app `1.6.0`, dados `V0059`)** — detalhes, OpenAPI e fixtures reais em `docs/fiscal/rtc/`:
- Distribuição oficial: zip de ~88 MB com `api-regime-geral.jar`, banco SQLite de regras e o código-fonte (Spring Boot, Java 21); roda com `--spring.profiles.active=offline` na porta 8080, context-path `/api`; OpenAPI em `/api/api-docs`. Não há imagem Docker oficial confirmada nem arquivo de licença no pacote.
- Partida ~4 min, ~714 MiB, 25–440 ms por cálculo. O site público tem WAF e bloqueia rajadas.
- Simples Nacional não é outro componente: é o campo `OpcaoSimplesNacional` do pedido.
- O fluxo de NFS-e são duas chamadas: `POST nfse/base-calculo` (ISS e desconto saem da base; ex.: 1000 − 100 − 30 = 870) e `POST regime-geral` (CBS/IBS por componente, com `memoriaCalculo`).
- **Competência ≥ 2027-01-01**: sem alíquotas nominais o motor responde 422; com elas calcula, mas marca `calculoSimulado: true`. A Corvo não estima alíquotas ⇒ bloqueio `TAX_RATE_NOT_FOUND` até o governo publicar as alíquotas.
- Catálogos (NBS, CST × cClassTrib por NBS, cIndOp) são consultáveis por endpoint e **não trazem vigência**: valem para a `data` consultada.

## 3. Calculadora RTC — adapter e deploy

- Implementação `HttpRtcCalculatorAdapter` do `RtcCalculatorPort` (Spec 2) em `infra/fiscal/rtc`. Config: `RTC_CALCULATOR_URL`, timeout, limite de concorrência, circuit breaker simples; **sem** fallback para a API pública de demonstração.
- Deploy: serviço interno no `deploy/docker-compose.yml` e no compose local, sem porta publicada, alcançável só pela rede privada da API/worker. Imagem/artefato e versão fixadas por digest; a versão do motor é lida do próprio serviço e gravada em cada snapshot.
- Responsabilidades: `health()`, `version()`, conversão do `FiscalContext` para o payload oficial, `calculate()`, interpretação de resposta e erro, memória de cálculo, fundamentação legal.
- Mapeamento de erros: erro de rede/timeout/5xx → `INTEGRATION`, `retryable = true`, `TAX_CALCULATION_UNAVAILABLE`; 4xx de validação do motor → `CALCULATION`/`CLASSIFICATION`, não retryable, com o detalhe oficial; operação fora do suporte do motor → `TAX_CALCULATION_UNSUPPORTED`; resposta que viola o schema ou a aritmética (componentes não somam, base incoerente) → `CALCULATION` não retryable. Erros do SDK/HTTP nunca saem do adapter.
- Retry controlado pela outbox (Spec 1); `Retry-After` respeitado quando vier; métricas `rtc_calculation_duration`, `rtc_calculation_failed_total`, `rtc_calculator_latency`; alerta de indisponibilidade.
- Testes de contrato contra o serviço real em ambiente controlado (CI opcional/etiquetado) e contra o OpenAPI salvo; fake continua para testes unitários.

## 4. Catálogos oficiais (NBS, CST, cClassTrib, cIndOp, local)

Como as respostas não trazem vigência, a validação **consulta a Calculadora com a data da competência** (`RtcFiscalCatalog`, com cache em memória invalidado quando `versaoApp/versaoDb` mudar), em vez de importar arquivos JSON. A versão dos dados (`1.6.0/V0059`) é gravada no snapshot, o que mantém a reprodutibilidade. O cTribNac continua no JSON do spec 2 (o motor não tem a lista nacional). Motor fora do ar durante a validação é falha **retryable** (não marca `catalogValidated=false`); sem Calculadora configurada, a classificação fica não validada e IBS/CBS obrigatório é bloqueado. `catalogValidated` passa a `true` quando o par CST × cClassTrib pertence à lista da NBS e o cIndOp é compatível.

## 5. DpsBuilder (Builder, sem regra fiscal)

- Entrada: `FiscalCalculationResult` + dados da invoice + emitente/tomador/numeração. Saída: objeto `DPS` tipado do `open-nfse` (`InfDPS`), nunca XML montado à mão.
- Passos: selecionar layout ativo → prestador → tomador (ou omitido quando permitido) → serviço (`cTribNac`, descrição, município) → tributação municipal (ISS/retenções conforme o resultado) → grupo `IBSCBS` (somente quando a engine marcou obrigação ou declaração aplicável: `finNFSe`, `cIndOp`, `indDest`, CST/cClassTrib) → totais → validação.
- Não decide regime, classificação ou aplicabilidade; só traduz o resultado da engine. Se faltar campo exigido pelo layout, devolve `DPS_SCHEMA_VALIDATION_FAILED` (não preenche por suposição).
- Layout ativo por ambiente: `FISCAL_DPS_LAYOUT` (padrão `rtc-v1.01`), com registro `{layout, status: published|homologated|in_production, since}` em `domain/fiscal/policies/rules/` (código versionado). Layout publicado mas não implantado, ou NT 009/V1.04.00, → `DPS_LAYOUT_UNSUPPORTED` (bloqueio explícito). Nada de XML presumido, nada de editar `node_modules`; se a lib atrasar, atualização controlada da dependência e dos XSDs com testes.
- Validação: guards da lib e validação XSD antes de transmitir; falha → `DPS_SCHEMA_VALIDATION_FAILED`, sem retry automático, invoice `rejected`.

## 6. Emissão com `emitirDpsPronta`

- `OpenNfseAdapter` (evolução do `OpenNfseProvider`) usa `emitirDpsPronta` quando a DPS tiver `IBSCBS` ou outros grupos avançados; o caminho `emitir(params)` atual permanece para DPS simples enquanto a engine estiver desligada.
- Como `emitirDpsPronta` não usa `DpsCounter`, a numeração continua vindo de `reserveNext` (já atômica por empresa/série) e a persistência da tentativa **antes** da transmissão segue o padrão atual: DPS assinada gravada em `pendingEmission` (RetryStore) antes do POST.
- **Tarefa de verificação do plano:** confirmar, lendo a API de `emitirDpsPronta` e com `NfseClientFake`, que (a) é possível assinar sem transmitir, (b) timeout deixa resultado indeterminado e `fetchDpsStatus`/`fetchByChave` resolvem antes de reenviar, (c) 429 respeita `Retry-After`. O que não for garantido pela lib é implementado no adapter; o comportamento existente de timeout → `reconciliation_required` → consulta antes de repetir é preservado.
- Timeout após transmissão = resultado indeterminado; consulta e reconciliação antes de qualquer reenvio; nenhuma nova DPS/numeração para a mesma invoice.

## 7. Conciliação

- Após `authorized`, `ReconciliationService` (job BullMQ próprio `nfse-fiscal-reconcile`, enfileirado após `authorized` com o mesmo padrão e opções do `nfse-doc-prep`; a outbox é só de entrada) lê o XML autorizado com `parseNfseXml`, extrai ISS, IBS/CBS e retenções apresentados e compara com o snapshot.
- Grava em `invoice_fiscal_reconciliations` (`invoice_id unique, tenant_id, authorized_values jsonb, local_values jsonb, differences jsonb, status: matched|within_tolerance|divergent, tolerance_rule, reconciled_at`). O snapshot e o XML autorizado **não são alterados**.
- Tolerância de arredondamento por tributo vem das regras versionadas em código (Spec 2). `divergent` → métrica `tax_reconciliation_mismatches_total`, webhook `nfse.invoice.fiscal_discrepancy`, `TAX_RECONCILIATION_REQUIRED` registrado para revisão fiscal. A invoice autorizada permanece `authorized` (sem novo status).
- XML original transmitido e autorizado persistidos conforme a política de retenção atual (S3, sem XML em log/telemetria).

## 8. Segurança e multitenancy

Certificados A1 seguem protegidos (sem alteração de `ApplicationCertificateDecryptor`). A Calculadora recebe apenas dados fiscais necessários (sem CPF/CNPJ completos do tomador quando o motor não exigir). Novas tabelas com RLS por tenant; logs sem PFX, senha, chaves ou XML.

## 9. Testes

Adapter RTC (contrato, timeout, 5xx, 4xx, resposta inválida, indisponibilidade); cenários 2026 e 2027 regime regular com cálculo real; redução validada; MEI/Simples sem grupo indevido; DPS: grupos corretos por regime, `IBSCBS` presente/ausente, CNPJ alfanumérico, XSD válido/inválido, layout não implantado e NT 009 → bloqueio; emissão: `NfseClientFake` com timeout, autorização posterior reconciliada sem duplicar DPS, 429; conciliação: igual, dentro da tolerância, divergente, XML intocado. **Produção Restrita da Sefin**: roteiro manual/automatizado opcional com credenciais; só cenários efetivamente executados são registrados como homologados em `docs/`.

## 10. Decisões em aberto

- **E1:** licença de uso da Calculadora em produção. O artefato (zip com jar) está identificado, mas o pacote não traz arquivo de licença; confirmar com o responsável do produto/jurídico. O governo descreve a ferramenta como gratuita e de código aberto.
- **E2:** se `emitirDpsPronta` não garantir (a)–(c) da §6, avaliar manter `emitir(params)` com extensão da lib vs. adapter próprio.
- **E3:** valores de tolerância de arredondamento (por regra, a conferir).

## 11. Fora de escopo

NT 009/V1.04.00 (notas de crédito/débito, `vAjusteBC`, locação), cancelamento/substituição, salão-parceiro, NF-e/NFC-e.
- **E4:** competências de 2027 em diante ficam bloqueadas até o governo publicar as alíquotas (o motor as exige como entrada). Decidir se a Corvo aceitará, no futuro, alíquotas informadas por fonte oficial versionada (nunca estimadas).
- **E5:** operação da atualização de versão (workflow semanal + runbook, Task 10 do plano).
