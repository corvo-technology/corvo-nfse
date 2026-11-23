# FiscalEngine — Limitações e cenários não homologados (Plano 2 / Spec 2)

Data: 2026-10-14 · Escopo: núcleo da FiscalEngine (`feat/fiscal-engine-core`).

Este documento registra, de forma explícita, o que **ainda não foi homologado**
neste estágio e quais decisões seguem pendentes de confirmação humana. Nada
aqui foi validado contra a **Calculadora RTC oficial** nem contra o ambiente de
**Produção Restrita** da NFS-e nesta etapa.

## 1. Cenários bloqueados / não exercitados de ponta a ponta

| Cenário | Situação | Motivo |
| --- | --- | --- |
| **IBS/CBS no regime regular (2026), modo `block`** | Bloqueado por design | O adaptador real da Calculadora RTC (Spec 3) existe, mas só é ligado quando `RTC_CALCULATOR_URL` está configurada. Sem ela a porta fica em `UnconfiguredRtcCalculator`, que devolve `TAX_CALCULATION_UNAVAILABLE` e, em modo `block`, a emissão é recusada. |
| **Simples Nacional / MEI em 2027 (opção pelo regime regular)** | `UNSUPPORTED` | As regras de transição para 2027 (Simples com IBS/CBS efetivos) ainda não têm os valores oficiais carregados. O motor bloqueia explicitamente (`TAX_CALCULATION_UNSUPPORTED`) até as regras serem carregadas — nunca degrada para `NOT_APPLICABLE`. |
| **ISS com regime `FIXED`** | Não exercitado | O resolvedor de ISS trata `NORMAL`/`EXEMPT`; o caso `FIXED` (alíquota fixa municipal) precisa da tabela/alíquota do município e de homologação contra o município de referência. |
| **Salão-parceiro (`PARTNER_SALON`)** | `FISCAL_REVIEW_REQUIRED` | A regra do Ato Conjunto RFB/CGIBS nº 4/2026 para salões de beleza com parceiros exige conferência das alíneas/ofícios específicos. O motor marca revisão manual em vez de presumir classificação. |
| **Dedução declarada pelo emitente (`deduction`)** | Implementado, **não homologado** | O emitente informa em `deduction` um valor a abater da base do ISS. Ele vai na DPS em `vDedRed/vDR` (validada contra o schema RTC v1.01) e a base do ISS passa a ser `gross − discount − deduction`. A base das retenções federais **não** muda. O Corvo não confere se a dedução é permitida para o serviço ou município. Ver `docs/fiscal/declared-deduction.md`. |
| **Mercadorias / operação `GOODS`/`MIXED`** | `OPERATION_DOCUMENT_UNSUPPORTED` | O Plano 2 cobre **serviços** (LC 116). Operações com mercadoria (`GOODS`) ou mistas (`MIXED`) exigem o módulo de produtos/NCM e ficam bloqueadas até um plano específico. |

## 2. O que NÃO foi homologado nesta etapa

- **Nenhum cenário** foi executado contra a **Calculadora RTC oficial** (adaptador real = Spec 3).
- **Nenhum cenário** foi executado contra a **Produção Restrita** da NFS-e nacional.
- Os valores de **2026** (CBS 0,9% / IBS 0,1%, dispensa de recolhimento) foram lidos das fontes oficiais (LC 214/2025 art. 343/346/348) e registrados em `docs/fiscal/rules-verification.md`, mas **não** validados fim a fim pelo sistema nacional.
- **Dedução `vDedRed/vDR`** (`deduction`): nenhuma nota com dedução foi enviada à **Produção Restrita**. Não se sabe se o município ou o sistema nacional aceitam a dedução sem exigir os documentos (`documentos`/`docDedRed`) nem se algum município a rejeita. Uma rejeição chega ao usuário em `lastErrorCode`/`lastErrorMessage`.
- **IBS/CBS com dedução**: a Calculadora RTC tem `vCalcDedRedIBSCBS` (locação de imóveis e serviços médicos) e `vCalcReeRepRes` (reembolso de bens de terceiros), que são hipóteses específicas; a dedução genérica `deduction` **não** é enviada a eles, então a base de IBS/CBS **não** é reduzida (conservador — nunca sub-exige). O Sefin pode calcular de outra forma.
- **Arredondamento**: a convenção interna (`HALF_UP`, 2 casas) não tem respaldo estatutário lido — é convenção de código pendente de confirmação fiscal.
- **`specificCategoryServiceCodes`** (categorias específicas do Ato Conjunto RFB/CGIBS nº 4/2026) ficou **vazio**: o ato define as categorias por **subitens da LC 116** (1.03, 1.05, 1.09, 16.01) e por natureza da operação, não por códigos cTribNac de 6 dígitos. Efeito: todos os serviços seguem a regra **geral** a partir de 01/10/2026 (conservador — nunca sub-exige).

## 3. Decisões humanas pendentes

- **D1 — `FISCAL_IBSCBS_UNAVAILABLE_MODE`**: manter `block` (padrão atual, não emite sem IBS/CBS) ou operar em `warn` (emite com warning durante a tolerância até 31/12/2026)? Definição de operação, não de código.
- **D2 — Aprovação de perfil fiscal em produção**: quem pode `approve` um `company_fiscal_profile` / `company_service_tax_profile` no ambiente `live` (papel/`RequirePermission`)? Hoje o fluxo existe mas o papel autorizado não está definido.
- **D3 — Categorias específicas do Ato Conjunto nº 4/2026**: confirmar a lista de subitens/naturezas que mudam de regra em 01/12/2026 e mapeá-los para códigos internos quando houver equivalência oficial.

- **D4 — IBS/CBS com dedução**: confirmar se e como a dedução declarada também reduz a base de IBS/CBS e, se sim, em qual campo da Calculadora RTC/DPS. Hoje não reduz.

## 4. Evolução dos planos

O cálculo pré-emissão (`POST /v1/invoices/calculate`, Plano 4) reutiliza a
permissão `nfse.invoices.issue`. O adaptador RTC, o DpsBuilder com o grupo IBSCBS,
a conciliação e a validação de catálogos foram entregues no Plano 3 (seção 5).

## 5. Plano 3 / Spec 3 — Calculadora RTC, DPS e conciliação

Data: 2026-10-15 · Escopo: `feat/rtc-dps-reconciliation`.

### 5.1 Nada foi homologado contra a Sefin
- **Produção Restrita da Sefin: não executado.** A emissão com DPS pronta foi exercitada apenas contra um transporte simulado (`MockAgent` + `NfseClientFake` do SDK) em `api/test/fiscal-dps-emission.e2e-spec.ts`. Isso prova o comportamento do cliente (assinar sem transmitir, timeout ⇒ consulta antes de reenviar, `Retry-After`, rejeição permanente, XSD), **não** que a Sefin aceita a DPS gerada. Sem certificado A1 de teste não há como marcar nada como homologado.
- A Calculadora foi validada contra a versão `1.7.2/V0073` em ambiente local (fixtures reais em `docs/fiscal/rtc/fixtures`). O teste de contrato `rtc-integration` só roda com `RTC_CALCULATOR_URL`.

### 5.2 Calculadora RTC
- **Competência ≥ 2027-01-01 (regime regular): bloqueada.** O motor exige alíquotas nominais que a base dele ainda não tem; sem elas responde 422 e a Corvo devolve `TAX_RATE_NOT_FOUND` (não retryable). Com alíquotas informadas o motor calcula, mas marca `calculoSimulado: true`, que a Corvo rejeita. Nenhuma alíquota é estimada.
- Diferimento (`gDif` com valor ≠ 0) em qualquer componente ⇒ `TAX_CALCULATION_UNSUPPORTED` (não mapeado).
- A ferramenta se declara **beta**; o grupo de endpoints de NFS-e também. O pacote oficial não traz arquivo de licença (decisão **E1**); o jar e o banco não são versionados no repositório.
- Partida do serviço ~4 min e ~714 MiB: o healthcheck usa `start_period: 420s`. Atualizações de versão são manuais (`runbooks/rtc-update.md`); o workflow semanal só avisa.
- A validação de NBS/CST/cClassTrib/cIndOp consulta o motor com a data da competência; com o motor fora do ar o erro é retryable (a invoice não é rejeitada na hora).

### 5.3 DPS (`DpsBuilder`)
- Só o layout `rtc-v1.01` está em produção (o `nt009-r1` fica restrito à Produção Restrita até o corte); layout não registrado ⇒ `DPS_LAYOUT_UNSUPPORTED`. **A NT 009 release 1 (leiaute V1.04.01) só roda no layout `nt009-r1`; ver [`nt-009-prontidao.md`](./nt-009-prontidao.md). Releases 2 e 3 não são suportadas.**
- O grupo `IBSCBS` é apenas declaratório (`finNFSe`, `cIndOp`, `indDest`, CST e cClassTrib). `indFinal`, `tpOper`, `dest`, `imovel`, `gRefNFSe` e `tpEnteGov` **não** são preenchidos sem dado confirmado; se o XSD exigir algum deles em um cenário, a DPS falha por `DPS_SCHEMA_VALIDATION_FAILED` em vez de ser preenchida por suposição.
- `vTotTrib` (total aproximado de tributos) segue zerado para todos os regimes (comportamento herdado); `regApTribSN` segue `1` (tributos federais e municipais pelo Simples) por padrão e não é configurável por empresa.
- A numeração DPS é reservada antes da montagem; quando o builder rejeita (layout/schema) o número fica consumido e associado à invoice, nunca devolvido à sequência.

### 5.4 Conciliação
- Tolerância de R$ 0,01 por tributo é uma política interna **pendente de confirmação fiscal (E3)**.
- Compara ISS (valor e base), CBS, IBS (UF, município e total) e a base de IBS/CBS; o valor líquido é apenas registrado.
- Divergência não altera a nota (status, XML e snapshot ficam intactos); o encaminhamento é humano (`runbooks/reconciliation-divergence.md`).

### 5.5 Fora do alcance deste plano (ver `docs/fiscal/mvp-mei-simples-pendencias.md`)
Regra de MEI/Simples a partir de 01/01/2027, checagem de adesão do município ao Emissor Nacional, `regApTribSN` configurável, roteiro de teste na Produção Restrita, validação com contador (totais aproximados, retenção de ISS, serviços permitidos ao MEI).

## 6. Cálculo pré-emissão (Plano 4)

- `POST /v1/invoices/calculate` está sempre disponível para API key/sessão
  autenticada com `nfse.invoices.issue`. Usa o mesmo rate limit HTTP autenticado
  dos outros endpoints (padrão 300/min por chave/sessão e 600/min por tenant), além de 120/min por tenant na rota.
- Aceita competência futura sem `options.type`, preservando o horizonte de
  `OUTBOX_SCHEDULE_MAX_DAYS` (15 dias por padrão). Não cria agendamento e resolve
  os perfis vigentes na competência. Não amplia o horizonte do `POST /invoices`.
- `ready` é cálculo pré-emissão; não valida certificado, prontidão de emissão ou
  aceite da Sefin. Os valores podem divergir na autorização. Não substitui
  homologação nem aconselhamento do responsável fiscal.
- Falhas fiscais esperadas retornam 200 `blocked` com dados parciais e
  `pendingFields`; falhas INTEGRATION retornam 503 com `Retry-After`, INTERNAL
  retorna 500 genérico. Request inválido e empresa inexistente mantêm 4xx normais.
- Nenhum dado é persistido pelo cálculo: não há invoice, evento, sequência DPS,
  outbox, snapshot/conciliação, crédito, webhook, BullMQ, S3 ou chamada à Sefin.
  Documento e nome do cliente não integram a resposta.
- **Desconto e paridade com a emissão:** o cálculo pré-emissão usa o desconto
  recebido no request. O mapper de persistência legado pode perder `discount`
  ao recarregar a nota para o worker; a paridade desta entrega foi verificada
  para entradas sem desconto. O problema precisa de correção separada antes
  de confiar em paridade de emissão com desconto. O fluxo de emissão não foi
  alterado nesta entrega.
- Simples que optar pelo regime regular em 2027, GOODS/MIXED e demais limitações acima continuam valendo.
- Perfis de serviço usam `service-tax-profiles`, nome real do contrato atual;
  o plano original citava `fiscal-services`. Não foi criada rota alternativa.

Veja [exemplos](examples.md), [observabilidade](observability.md) e o
[registro de homologação](homologation.md). A implementação e os testes de
cálculo não acrescentam homologação na Produção Restrita.
