# NF-e pela SEFAZ Virtual de Contingência (SVC)

Quando a SEFAZ do estado de uma empresa para de responder, a Corvo manda a NF-e (modelo 55) pela
SVC: **SVC-AN** (Ambiente Nacional) ou **SVC-RS** (Rio Grande do Sul), conforme o estado (Ato COTEPE
39/2012). Só vale para a NF-e. A NFS-e e a NFC-e não usam a SVC, e a inutilização é sempre feita na
SEFAZ do estado.

## Quando a Corvo entra na SVC

Por estado e ambiente (`nfe_contingency_states`, global, não é da empresa). O vigia roda a cada minuto
(`NfeSvcSwitchScheduler`) e entra quando:

1. a situação da SEFAZ de origem é `authority_down`: o disjuntor `nfe-<origem>-<tpAmb>` está aberto
   **ou** a sonda TCP dela falhou, **e** o resto do governo responde (`network` normal);
2. o disjuntor da SVC do estado (`nfe-svcan-<tpAmb>` ou `nfe-svcrs-<tpAmb>`) está fechado;
3. a sonda da SVC responde.

Se quem não alcança o governo é a nossa rede (`gov_unreachable_from_us` ou `no_internet`), a SVC **não**
é usada: ela também é um endereço do governo. O caminho certo é o proxy de reserva (Contingência 4/4).

A Corvo **sai** sozinha quando a SEFAZ de origem voltou ao normal (disjuntor fechado, rede normal) e a
sonda dela responde.

Ao entrar e ao sair, a Corvo avisa por webhook (`nfe.contingency.entered` e `nfe.contingency.exited`) as
contas que têm ao menos uma empresa no estado, e por e-mail os endereços de
`OPS_ALERT_EMAILS`.

## O que muda em cada nota

- **Nota nunca enviada** (`queued`, ou `retry_pending` com `transmitted_at` vazio): ganha **chave nova**
  com `tpEmis` 6 (SVC-AN) ou 7 (SVC-RS), com o mesmo número e série. O XML leva `dhCont` (hora de
  entrada na SVC, no fuso do estado) e `xJust` ("SEFAZ de origem indisponivel"). A chave antiga fica em
  `nfe_document_history`.
- **Nota que pode ter chegado na SEFAZ de origem** (`transmitted_at` preenchido, `processing`,
  `reconciliation_required`): **nunca muda de chave**. Espera a origem e segue a conciliação pela chave
  original. Isso evita duas notas para a mesma venda.
- `transmitted_at` é gravado e confirmado no banco logo antes da chamada SOAP de autorização. Um
  disjuntor que bloqueia a chamada não grava nada.
- Consulta e eventos (cancelamento, carta de correção) de uma nota com `tpEmis` 6 ou 7 vão aos
  endereços da SVC, escolhidos pelo dígito 35 da chave (`endpointTpEmis`, em `endpoints.ts`).
- O DANFE da nota diz "EMITIDA EM CONTINGÊNCIA SVC-AN|RS em dd/mm/aaaa hh:mm:ss. Motivo: ...". A tela da
  nota mostra o aviso e a API traz `emissionType`, `contingencyAt` e `contingencyReason`.

## Como confirmar que a SEFAZ de origem ativou a SVC

A SVC só autoriza para o estado depois que a SEFAZ de origem a coloca em operação (ou depois de
avisar a contingência no Portal da NF-e). Se a SVC rejeitar a nota por o estado não estar em
contingência, a nota fica `rejected` com o `cStat` da SEFAZ e a Corvo continua tentando a origem nas
próximas emissões. **[Verificar na homologação]** qual `cStat` a SVC devolve para um estado que não está
em contingência e se ele deve levar a nota de volta à origem.

## Como forçar a saída

Painel de administração, bloco "NF-e na contingência (SVC)": cada estado em SVC tem o botão
"Sair da SVC" (pede um motivo de 5 a 500 caracteres, que fica na auditoria como `svc_forced_exit`).
A saída forçada avisa por webhook e e-mail como a automática. Se a Corvo ainda achar a origem fora do
ar, ela pode voltar a entrar no minuto seguinte: nesse caso confira o disjuntor e as sondas.

## O que verificar antes de liberar em produção

- Os endereços da SVC (`ENDPOINTS_SVC` em `api/src/infra/external/nfe/sefaz/endpoints.ts`):
  `hom.svc.fazenda.gov.br` / `www.svc.fazenda.gov.br` (SVC-AN) e `nfe-homologacao.svrs.rs.gov.br` /
  `nfe.svrs.rs.gov.br` (SVC-RS). **[Não verificado: conferir no Portal da NF-e e no MOC, Anexo III.]**
- A regra de roteamento de consulta e evento de nota emitida na SVC (SVC ou origem). Está isolada em
  `endpointTpEmis`: se a homologação mandar para a origem, só essa função muda.
- A sonda da SVC é a TCP do monitor (`AuthorityReachabilityStore`), não a consulta SOAP de status, que
  pediria um certificado A1. Se for preciso a consulta SOAP, troque a implementação de `SEFAZ_STATUS`.
- A regra de `dhCont` (hora de entrada) em relação a `dhEmi` na SVC.
- A produção continua travada por `NFE_PRODUCTION_ENABLED`. A chave da SVC olha todos os estados (NF-e) em homologação, e também em produção quando esse interruptor está ligado.

## Inutilização em SP

Continua sendo sugerida (lacunas e número perdido) até o contador confirmar os Ajustes SINIEF 38/2026 e
40/2026. A SVC não faz inutilização.
