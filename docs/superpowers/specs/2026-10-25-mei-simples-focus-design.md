# Foco em MEI e Simples Nacional na NFS-e nacional — design

Data: 2026-10-25 · Status: rascunho para aprovação

## 1. Intenção

A Corvo passa a atender **somente MEI e Simples Nacional (ME/EPP)**, e somente pela **NFS-e nacional**. O objetivo é que toda nota emitida por essas duas categorias saia **aceita pela Sefin/ADN**, hoje e a partir de 2027, e que o produto deixe de carregar código e promessas para regimes que não atende.

Por que agora:

- A Resolução CGSN 191/2026 torna a NFS-e nacional obrigatória para ME/EPP do Simples a partir de **01/11/2026**. O MEI já é obrigado desde 2023. Quem sai do portal e vem para uma API precisa que a nota passe de primeira.
- As regras de IBS/CBS para optantes começam em **01/01/2027**. Hoje o nosso motor **bloqueia** toda emissão de MEI e de Simples com competência a partir dessa data (`UNSUPPORTED`).
- A leitura do Anexo I oficial do layout (DPS v1.01, 09/02/2026) mostrou regras de rejeição que o nosso DPS pode estar violando para MEI e Simples (seção 4).

## 2. Objetivos, não objetivos e anti-objetivos

**Objetivos**

1. Aceitar só MEI e Simples Nacional ME/EPP; recusar Lucro Presumido, Lucro Real e demais.
2. Conformidade do DPS enviado com as regras de rejeição do Anexo I para MEI e ME/EPP (tabela da seção 4).
3. Informar corretamente o regime de apuração (`regApTribSN`) e o total aproximado de tributos (`pTotTribSN` / `indTotTrib`).
4. Emitir MEI e Simples sem bloqueio em competência a partir de 01/01/2027, com o grupo IBSCBS conforme a NT SE/CGNFS-e 9/2026.
5. Conferir o regime e o município da empresa contra o cadastro público de CNPJ/Simples ao cadastrar, para evitar E0160 e E0041.
6. API, MCP, OpenAPI, docs, site e `llms.txt` falando só de MEI e Simples.

**Não objetivos**

- Calcular, gerar ou enviar DAS (PGMEI, PGDAS-D, Integra Contador). Fica como fase futura, sem mudar este desenho.
- Calcular a alíquota efetiva do Simples a partir do faturamento (RBT12).
- Apurar ISS fora do DAS (`regApTribSN` 2 ou 3, Simples que passou do sublimite) nesta entrega.
- Outros documentos fiscais (NF-e, NFC-e) ou outros regimes.

**Anti-objetivos** (seria falha mesmo que tecnicamente funcionasse)

- Enviar um número inventado ou zerado em um campo fiscal só para a nota passar.
- Remover o histórico de empresas já cadastradas com outros regimes.
- Esconder do cliente uma nota que será rejeitada pela Sefin depois de reservar crédito.

## 3. Decisões já tomadas pelo dono do produto

| Decisão | Resultado |
|---|---|
| Regimes aceitos | Somente MEI e Simples Nacional. Não há empresas de outros regimes hoje |
| Escopo de documento | Somente NFS-e nacional |
| DAS | Fora do escopo |
| Alíquota do Simples (`pTotTribSN`, IBS/CBS de 2027) | **O cliente informa e atualiza.** Não consultamos nem calculamos |
| Integra Contador (Serpro) | Fase futura, alimentando o mesmo campo |

## 4. Conformidade com o Anexo I (fonte da verdade)

Fonte: *Anexo I – SEFIN/ADN – DPS_NFS-e, v1.01, 09/02/2026*, abas `RN DPS_NFS-e` e `LEIAUTE DPS_NFS-e`. As colunas abaixo comparam a regra com o que fazemos hoje.

| Regra | Texto resumido | Hoje | Ação |
|---|---|---|---|
| E0436 | MEI não pode enviar dedução/redução (`vDedRed`) | **Violada**: enviamos `vDedRed` se `deduction > 0`, sem olhar o regime (`dps-builder.ts`, bloco `vDedRed`) | Rejeitar `deduction` para MEI na validação, antes de reservar crédito |
| E0441 / E0442 | ME/EPP com `regApTribSN = 1` só pode dedução nos `cTribNac` da lista do Anexo I (`042201, 042301, 050901, 060101, 060201, 070201, 070202, 070501, 070502, 090201, 090202, 100101…100105, 100201, 100202, 100301, 100401…100403, 100501, 100502, 100601, 100701, 100801, 100901, 101001, 150101…150105, 151001…151005, 160201, 170501, 170601, 171001, 171002, 171101, 171102, 171201, 210101, 250301`) | **Violada**: mesmo caso acima | Rejeitar `deduction` quando o `cTribNac` não está na lista. Estar na lista é condição necessária; a parametrização do município é verificada pela Sefin |
| E0583 | MEI não pode ter retenção de ISS (`tpRetISSQN` deve ser 1) | **Violada**: `issWithheld = REQUIRED` para tomador CNPJ com retenção configurada, inclusive MEI (`common-obligations.ts`) | `issWithheld = NOT_APPLICABLE` para MEI |
| E0600 | MEI não pode informar alíquota (`pAliq`) | Verificar: o DPS de MEI não deve carregar `pAliq` | Teste de conformidade; corrigir se falhar |
| E0534 | MEI não pode informar benefício municipal | Não enviamos benefício | Teste de conformidade |
| E0536 | ME/EPP no SN com município ativo não informa benefício municipal | Não enviamos | Teste de conformidade |
| E0162 | `regApTribSN` não pode ser enviado por não optante ou MEI | Já respeitado | Teste de conformidade |
| E0166 | `regApTribSN` é obrigatório para ME/EPP | Enviado, mas **fixo em 1** | Vem do perfil fiscal (seção 6.3) |
| E0174 / E0175 | `regEspTrib = 0` para MEI e para ME/EPP com `regApTribSN = 1` | Já validado (`dps-builder.ts`) | Manter |
| E0710 | MEI nunca envia `pTotTribSN` | Não enviamos | Manter e testar |
| E0712 | ME/EPP nunca envia `indTotTrib` | Não enviamos | Manter e testar |
| E0713 | Não optante não envia `indTotTrib`/`pTotTribSN` | Fora de escopo (recusamos não optante) | — |
| `totTrib` (1-1) | Escolha obrigatória: `vTotTrib`, `pTotTrib`, `indTotTrib` ou `pTotTribSN` | **Fixo `vTotTrib` = 0/0/0** | MEI: `indTotTrib = 0`. ME/EPP: `pTotTribSN` (seção 6.3) |
| E0160 | `opSimpNac` deve bater com o cadastro do Simples **na data de competência** | Não verificamos | Conferência no cadastro (seção 6.5), com a Sefin como autoridade final |
| E0041 | Município emissor do MEI = município do endereço no CNPJ | Não verificamos | Conferência no cadastro (seção 6.5) |
| IBSCBS | Grupo só é obrigatório para optantes a partir de 2027; permitido a partir da competência 01/01/2026 e DPS v1.01 (E0850, E0854) | Bloqueamos a emissão a partir de 2027 | Seção 6.4 |

Cada linha "Ação" ou "Teste de conformidade" vira um teste nomeado pelo código da regra (por exemplo `E0436`), para a suíte ser a prova de conformidade.

## 5. Visão geral da solução

```
cadastro (API/MCP/web) ──> só MEI | Simples        (6.1)
        │
perfil fiscal ──> regime, regApTribSN, alíquotas   (6.3)  ◄── cliente atualiza mensalmente
        │
motor fiscal ──> MEI | Simples (única estratégia)  (6.2, 6.4)
        │
DPS ──> totTrib correto, sem campos proibidos      (4, 6.2)
        │
conferência de CNPJ/Simples no cadastro            (6.5)
```

## 6. Desenho

### 6.1 Aceitar só MEI e Simples

- `TAX_REGIMES` em `company.dto.ts` passa a ter somente `'MEI'` e `'Simples Nacional'`. Qualquer outro valor devolve `422` com `ERROR_TAX_REGIME_NOT_SUPPORTED` e mensagem que diz que a Corvo atende MEI e Simples Nacional.
- Vale para `POST /companies`, `PATCH /companies/:id`, `PUT /companies/:id/fiscal-profile`, a tool MCP `company_create` (`tax_regime` enum) e o formulário web.
- **Não há empresas de outros regimes na base**: todas as empresas atuais são Simples Nacional (informação do dono do produto em 2026-10-25). Por isso não existe tratamento de empresas legadas: nada de migração de dados, estado "bloqueada por regime" ou comunicação a clientes afetados.
- Os valores `LUCRO_PRESUMIDO`, `LUCRO_REAL`, `OUTRO_REGIME` e `UNKNOWN` podem **continuar no tipo e nos CHECKs do banco** (`company_fiscal_profiles`, `invoice_fiscal_snapshots`) nesta entrega; remover do banco é uma limpeza opcional que o construtor decide, já que não há dado a preservar. Se algum dia aparecer uma empresa com outro regime, o motor devolve o bloqueio `TAX_REGIME_NOT_SUPPORTED` (defesa em profundidade, não um fluxo de produto).

### 6.2 Motor fiscal com duas estratégias

- `TaxStrategyResolver` resolve somente `MeiTaxStrategy` e `SimplesNacionalTaxStrategy`. Outro regime vira o bloqueio acima.
- `RegularTaxStrategy` deixa de ser estratégia. A função `regularIbsCbs`, usada pelo Simples que optou pelo regime regular de IBS/CBS (`ibsCbsRegularOption`, `regApIBSCBSSN = 3`), permanece, em arquivo próprio. O restante do ramo "regular" (ISS calculado pela Corvo) sai.
- **Dedução:** `FiscalValidator` rejeita `deduction > 0` com o código de erro novo `DEDUCTION_NOT_ALLOWED_FOR_REGIME` para MEI e para ME/EPP com `cTribNac` fora da lista da seção 4. A rejeição acontece no `calculate` e no `emit`, **antes** da reserva de crédito.
- **Recusas síncronas, antes de reservar crédito:** hoje o `FiscalValidator` roda no motor assíncrono, depois da reserva (`invoice-lifecycle.service.ts`), e a única checagem síncrona é `normalizeAndValidate` em `invoice-intake.service.ts`. Tudo o que a Corvo já consegue saber na hora do `POST /invoices` passa a ser recusado ali com `422`, sem reservar crédito: regime não suportado, dedução proibida para o regime (acima), taxa do Simples ausente (6.3) e Simples acima do sublimite (6.3). Isso exige resolver a taxa do mês dentro do intake. O motor assíncrono repete as checagens como defesa em profundidade.
- **Retenção:** para MEI, `issWithheld = NOT_APPLICABLE` com a razão "MEI não sofre retenção de ISS (E0583)". Para ME/EPP a lógica atual (exigir `simplesIssRate`) permanece.
- **DPS:** `dps-builder` monta `totTrib` conforme 6.3 e nunca envia `pAliq` nem benefício municipal para MEI.

### 6.3 Perfil fiscal e alíquotas informadas pelo cliente

**Campos novos no perfil fiscal do ME/EPP** (tabela `company_fiscal_profiles`, versionada por `validFrom`, como hoje):

- `simplesApuracao`: `'SN'` (padrão) | `'ISS_MUNICIPAL'` | `'REGULAR'`, que mapeia para `regApTribSN` 1, 2, 3. **Somente `'SN'` é suportado nesta entrega.** Os outros valores são recusados com `422 ERROR_VALIDATION` e `details[].code = ERROR_SIMPLES_SUBLIMIT_NOT_SUPPORTED`, e o motor devolve bloqueio explícito (não emite com regime errado).
- Para o MEI o campo não existe e `regApTribSN` nunca é enviado.

**Alíquotas mensais, tabela nova `company_simples_rates`** (decisão de projeto, ver 10.1):

- Chave: `(company_id, competence_month 'YYYY-MM')`, mais `tenant_id` e `environment` como nas demais tabelas.
- Campos: `total_rate` (percentual, 2 casas, 0 a 100; alimenta `pTotTribSN`) e `iss_rate` (percentual, 2 casas; substitui o papel de `simplesIssRate` para retenção). IBS e CBS do Simples em 2027 não são informados pelo cliente (seção 6.4).
- `simplesIssRate` do perfil continua existindo como **valor de reserva** quando não há linha para o mês, para não quebrar quem já usa.
- **Resolução da taxa para uma nota:** a linha do mês de competência; se não existir, a do mês anterior mais próximo (repete o último valor informado); se nunca informada, **ausente**.
- **Ausente para ME/EPP em competência a partir de 01/11/2026:** bloqueio `MISSING_CONFIGURATION` com `missingFields: ['simplesRate.totalRate']` e mensagem que diz onde informar. Antes dessa data, a nota segue como hoje.
- **Valor antigo:** se a taxa usada tem mais de 1 mês de defasagem, a resposta de cálculo inclui um *warning* `SIMPLES_RATE_STALE`, sem bloquear.
- **API:** `PUT /companies/:id/simples-rates/:month` (cria ou substitui) e `GET /companies/:id/simples-rates`. Permissão `nfse.companies.manage`. Não passam pelo fluxo de aprovação do perfil fiscal, porque mudam todo mês.
- **MCP:** tool `company_set_simples_rate` (`company_tax_id`/`company_id`, `month`, `total_rate`, `iss_rate?`) e `company_get` passa a mostrar a taxa vigente.
- **Web:** campo "Alíquota do Simples do mês" no detalhe da empresa, com a data da última atualização e o aviso de valor antigo.
- **MEI:** `totTrib` com `indTotTrib = 0` (E0710 proíbe `pTotTribSN`). **ME/EPP:** `pTotTribSN` = `total_rate` resolvida; nunca `indTotTrib` (E0712).

### 6.4 IBS/CBS de 2027 para MEI e Simples

Estado hoje: `MeiTaxStrategy` e `SimplesNacionalTaxStrategy` devolvem `UNSUPPORTED` para competência ≥ `2027-01-01`, o que bloqueia a emissão.

**O que a NT SE/CGNFS-e 9/2026 (v1.01, 01/10/2026) diz**, lido no *Anexo VI – leiautes e regras, v1.04.01* (planilha oficial):

- **O emitente informa pouco.** No DPS, para ME/EPP (`opSimpNac = 3`) ou Optante Pendente (`4`), o campo novo `prest/regTrib/regApIBSCBSSN` é **obrigatório** e diz como o IBS e a CBS são apurados: `1` IBS e CBS pelo Simples, `2` CBS pelo Simples e IBS pelo regime regular (acima do sublimite), `3` IBS e CBS pelo regime regular. O MEI não informa `regApIBSCBSSN`.
- **O sistema nacional calcula o resto.** `vReceitaBrutaSN`, o grupo `gTribSN` (`pIBSSN`, `vIBSSN`, `pCBSSN`, `vCBSSN`) e os totais ficam **na NFS-e gerada pelo sistema**, e as alíquotas devem ser iguais às devolvidas pela Calculadora nacional. O cliente **não** informa alíquota de IBS nem de CBS: por isso a Corvo **não** guarda `ibs_rate`/`cbs_rate` (removidos da API e do MCP).
- **Valor novo de `opSimpNac`:** `4 – Optante Pendente` (opção pelo Simples ainda em análise). Hoje a Corvo só trata 1, 2 e 3.
- Novo campo `cAtvSN` (código da atividade do Simples), informado só quando `opSimpNac = 2`, com validação própria na versão 1.01 da NT.
- O `cClassTrib` informado precisa ser válido para a prestação de serviços; a Calculadora indica `tpRBSN` (receita bruta interna, externa ou "não é receita bruta").

**Bloqueios de implementação encontrados:**

1. **A `open-nfse` 0.11.0 (a última publicada no npm) não tem `regApIBSCBSSN`, `opSimpNac = 4` nem `cAtvSN`.** Sem eles o DPS de ME/EPP a partir da data de vigência seria rejeitado.
2. **As datas de vigência da NT 9 ainda não foram publicadas** (o portal diz que o cronograma será divulgado "nas próximas semanas"). O pacote de XSD que baixamos (v1.01 de 09/02/2026) não contém os campos novos, e não achei um XSD novo na página.
3. Os campos `vReceitaBrutaSN` e `gTribSN` não são enviados por nós, mas a Calculadora nacional passa a ser a fonte de verdade para o Simples: a nossa Calculadora RTC local (container `rtc-calc`) **não** substitui isso.

**Desenho (sem mudança de decisão de produto):**

- `FISCAL_2027_SIMPLES_MEI` continua desligada, e desligada o bloqueio de 2027 permanece.
- Quando a lib (ou uma extensão nossa do builder de DPS) gerar `regApIBSCBSSN`, o motor passa a enviar `regApIBSCBSSN = 1` para ME/EPP (suportado) e bloqueia `2` e `3` como em 6.3. `regApIBSCBSSN` vem do mesmo `simplesApuracao` do perfil fiscal.
- MEI: nenhuma informação nova do emitente é exigida pela NT, além de `cAtvSN`; avaliar na implementação.
- **Pré-requisitos antes de implementar:** (a) a data de vigência e a versão do XSD, (b) uma versão da `open-nfse` que gere os campos novos, ou aval para estender o builder nós mesmos (alternativas: contribuir para a lib, ou pós-processar o XML antes da assinatura), (c) confirmar com a Calculadora nacional o comportamento de `cClassTrib` para optantes.

### 6.5 Conferência de regime e município no cadastro

- Nova porta `SimplesRegistryPort.lookup(cnpj, competenceDate)` devolvendo `{ optanteSimples, optanteMei, municipalityCode, source }`.
- Primeiro adaptador: consulta pública de CNPJ (a escolher na implementação entre BrasilAPI e ReceitaWS; ver 10.3), com cache de 24 h e *timeout* curto.
- Só em `POST /companies` (não em `PUT /fiscal-profile` nem nas tools MCP de perfil), comparando com o cadastro **na data de hoje**: se o cadastro público contradiz o regime informado (por exemplo diz MEI e o cliente informou Simples), ou se o município do MEI não bate com o do CNPJ, a resposta de criação traz um *warning* (`TAX_REGIME_REGISTRY_MISMATCH` / `MEI_MUNICIPALITY_MISMATCH`) com o que o cadastro diz. **É aviso, não recusa**, e não há campo de confirmação: as fontes públicas atrasam em relação à mudança real de regime, e quem decide é a Sefin.
- **Falha do serviço externo nunca bloqueia** nem gera aviso de contradição: registra log e segue. A Sefin (E0160, E0041) continua sendo a autoridade final.
- Mensagem de rejeição E0160 vinda da Sefin passa a ser traduzida para um erro claro de regime ("o cadastro do Simples Nacional diz outra coisa na data de competência") em vez de erro genérico.

### 6.6 API, MCP, docs e site

- OpenAPI, descrições de campos e exemplos: só MEI e Simples; novo `ERROR_TAX_REGIME_NOT_SUPPORTED` na tabela de erros.
- Docs EN/PT: página de empresas, erros, MCP (nova tool), seção "Simples Nacional: alíquotas e 2027", aviso de que a Corvo não gera DAS.
- Site/landing e `messages/*.json`: remover menções a Lucro Presumido/Real; reforçar "MEI e Simples Nacional".
- `llms.txt` (`api/` e `web/public/`), `FRONTEND_API.md`, README.
- Formulário web `company-form.tsx` e `lib/company-fiscal.ts`: apenas os dois regimes.

## 7. Entrega em fases e prazos

| Fase | Conteúdo | Prazo alvo |
|---|---|---|
| 0 | Seção 4 corrigida (E0436/E0441/E0442, E0583, testes de conformidade) + recusar outros regimes (6.1) | antes de **01/11/2026** |
| 1 | Perfil e alíquotas (6.3): `regApTribSN`, `totTrib` correto, tabela e endpoints de alíquotas, MCP e web | até meados de **dezembro/2026** |
| 2 | IBS/CBS 2027 (6.4), dependente da NT 9/2026 | até **31/12/2026** |
| 3 | Conferência de CNPJ (6.5), docs, site e limpeza do ramo regular | junto com 1 e 2; limpeza depois |

### 7.1 Liberação gradual por variáveis de ambiente

Tudo é construído primeiro **desligado** e liberado aos poucos mudando o `.env` do deploy (Dokploy). Com tudo desligado o comportamento é idêntico ao de hoje, então dá para mesclar cada parte assim que os testes passarem, sem esperar o conjunto. Segue o padrão de `env.schema.ts` (`booleanFromEnv`, e enums `off|warn|block` como `FISCAL_IBSCBS_UNAVAILABLE_MODE`). As flags são lidas na subida do processo: mudar uma exige reiniciar a API.

| Flag | Valores | Padrão | O que liga |
|---|---|---|---|
| `TAX_REGIME_RESTRICTION` | `off` `on` | `off` | 6.1: recusar regimes que não sejam MEI ou Simples |
| `FISCAL_DPS_CONFORMANCE` | `off` `on` | `off` | Seção 4 e recusas síncronas de 6.2: dedução proibida, retenção do MEI, campos proibidos |
| `SIMPLES_TOTTRIB` | `off` `on` | `off` | 6.3: enviar `indTotTrib`/`pTotTribSN` e o `regApTribSN` do perfil em vez de zeros |
| `SIMPLES_RATE_MODE` | `off` `warn` `block` | `off` | 6.3: alíquota do mês ausente. `warn` só avisa, `block` recusa com `422` |
| `SIMPLES_RATE_ENFORCED_FROM` | data `YYYY-MM-DD` | vazio | só exige a alíquota para competência a partir dessa data |
| `FISCAL_2027_SIMPLES_MEI` | `off` `on` | `off` | 6.4: grupo IBSCBS de 2027. `off` mantém o bloqueio atual |
| `CNPJ_REGISTRY_CHECK` | `off` `on` | `off` | 6.5: aviso de divergência no cadastro |
| `*_TENANTS` (uma para cada flag acima, opcional) | lista de UUIDs ou `*` | vazio | libera a flag só para esses tenants (canário), em vez de para todos |

Regras de construção:
- As **tabelas, colunas e endpoints** de alíquotas existem desde o primeiro deploy, mesmo com `SIMPLES_RATE_MODE=off`, para os clientes poderem preencher antes de a exigência ligar.
- Cada flag tem teste nos dois estados (ligada e desligada); desligada é igual ao comportamento atual.
- Depois de uma flag ficar ligada para todos por um tempo combinado e sem incidentes, o código da versão antiga e a flag são removidos (uma limpeza por flag, em PR próprio).
- Mudanças de **contrato de API** (por exemplo o `422` de regime) também ficam atrás da flag e só valem quando ela é ligada.

Sequência sugerida de liberação, cada passo com um deploy e uma observação de erros da Sefin antes do próximo: `FISCAL_DPS_CONFORMANCE` → `TAX_REGIME_RESTRICTION` → `SIMPLES_TOTTRIB` (junto de clientes já tendo preenchido a alíquota) → `SIMPLES_RATE_MODE=warn` → `SIMPLES_RATE_MODE=block` com `SIMPLES_RATE_ENFORCED_FROM` → `CNPJ_REGISTRY_CHECK` → `FISCAL_2027_SIMPLES_MEI` quando a NT 9/2026 estiver implementada.

A fase 0 é pequena e tem prioridade absoluta: corrige notas que podem estar sendo rejeitadas e para de aceitar clientes que não atendemos.

## 8. Testes e critério de pronto

- **Suíte de conformidade do Anexo I:** um teste por regra da seção 4, nomeado pelo código (`E0436`, `E0441`, `E0583`, `E0600`, `E0710`, `E0712`, `E0162`, `E0166`, `E0174`, `E0175`), montando o DPS real do `dps-builder` para MEI e para ME/EPP e verificando a regra. Opcional e desejável: validar o XML contra o XSD v1.01 oficial.
- **Unitários e integração** (Postgres real) para: recusa de regimes, bloqueio de empresas legadas, resolução de alíquota por mês com repetição do último valor, `SIMPLES_RATE_STALE`, bloqueio `MISSING_CONFIGURATION`.
- **e2e HTTP e MCP:** cadastro de Lucro Presumido devolve 422; cadastro de MEI e Simples funciona; atualização de alíquota; emissão com `totTrib` correto no ambiente de teste.
- **Pronto quando:** nenhuma regra da tabela está "Violada"; competência em 2027 de MEI e ME/EPP não bloqueia por `UNSUPPORTED` (ou o risco está registrado por escrito se a NT não estiver publicada); docs e site sem menção a outros regimes; suíte verde.

## 9. Riscos

1. **Fase 2 depende de terceiros:** a NT 9/2026 já está publicada, mas a data de vigência e o XSD com os campos novos não foram encontrados e a `open-nfse` 0.11.0 não gera `regApIBSCBSSN` nem `opSimpNac = 4` (ver 6.4). Sem isso as notas de 2027 continuam bloqueadas.
2. **Cliente não informa a alíquota:** com o bloqueio de 6.3, ME/EPP deixa de emitir em vez de emitir errado. É deliberado, mas gera suporte. Mitigação: aviso, MCP e valor repetido do mês anterior.
3. **Qual alíquota informar:** o layout diz "percentual aproximado do total dos tributos da alíquota do Simples". As fontes que achei não são conclusivas entre efetiva e nominal. Confirmar com a Receita ou um contador antes de documentar ao cliente (ver 10.4).
4. **Fonte pública de CNPJ** instável ou com limite de uso. Mitigação: nunca bloquear por falha dela.
5. **Mudança de comportamento de API** (cadastro de outros regimes passa a falhar): comunicar na documentação e no changelog.

## 10. Chamadas minhas e pontos abertos para o construtor

1. **Tabela `company_simples_rates` em vez de reaproveitar o perfil fiscal.** Escolhi tabela própria porque a alíquota muda todo mês e o perfil fiscal exige fluxo de aprovação e cria uma versão por mudança. Alternativa: novo campo no perfil, com aprovação automática.
2. **Layout de 2027:** a seção 6.4 foi conferida no Anexo VI v1.04.01 da NT 9/2026 (planilha oficial). Falta ler o texto da NT (PDF) sobre vigência e obter o XSD novo.
3. **Fonte pública de CNPJ:** BrasilAPI ou ReceitaWS; o construtor escolhe depois de verificar o que cada uma devolve sobre opção pelo Simples/MEI e município, limites de uso e custo.
4. **Efetiva ou nominal:** `pTotTribSN` assumido como a alíquota efetiva total do mês, a confirmar.
5. **Sublimite (`regApTribSN` 2/3):** bloqueado nesta entrega por escolha minha. Se houver clientes nessa situação, vira uma fase própria que exige calcular ISS fora do DAS (alíquota municipal via `consultarAliquota` da `open-nfse`).
6. **Bloqueio de ME/EPP sem alíquota a partir de 01/11/2026:** escolhi bloquear em vez de emitir com valor zerado. Se o negócio preferir um período de tolerância, trocar o bloqueio por *warning* até uma data a definir.
8. **Conferência de CNPJ é só aviso** (6.5), sem recusa nem override, porque as fontes públicas atrasam. Se o negócio quiser recusa dura, é mudança de contrato da API com campo de confirmação.
9. **Recusas síncronas** (6.2): eu decidi que regime, dedução e taxa ausente são `422` no intake, antes de reservar crédito, em vez de rejeição assíncrona com estorno.
10. **Dados atuais:** a base tem só empresas Simples Nacional (dono do produto, 2026-10-25), então não há notas em fila de empresas de outros regimes. Antes de ligar a fase 0, o construtor roda uma consulta de auditoria por `tax_regime IN ('UNKNOWN','OUTRO_REGIME')` (a migração mapeou regimes não reconhecidos para `UNKNOWN`) e corrige à mão qualquer ocorrência.
11. **Cronograma da alíquota:** com as flags, o envio de `pTotTribSN` e o bloqueio por alíquota ausente deixam de depender da data da fase 1. Os zeros em `vTotTrib` continuam até `SIMPLES_TOTTRIB=on`, e a exigência começa em `warn`, depois `block`, quando os clientes tiverem preenchido. É uma exceção temporária e consciente ao anti-objetivo de não enviar número zerado.
12. **Canário por tenant** via `*_TENANTS` é minha adição: sem ela só dá para ligar para todos de uma vez.
7. **Recursos da `open-nfse` não usados** e úteis depois (fora desta spec): `fetchByNsu` (espelhar notas emitidas fora da Corvo), `consultarAliquota`/`consultarConvenio`/`consultarRetencoes`, `substituir` e `consultarDanfse`.

## 11. Fontes

- Anexo I – SEFIN/ADN – DPS_NFS-e v1.01 (09/02/2026) e XSD v1.01: <https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual>
- Receita Federal, Resolução CGSN 191/2026: <https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2026/agosto/simples-nacional-nfs-e-nacional-sera-obrigatoria-para-me-e-epp-a-partir-de-1o-de-novembro-de-2026>
- FecomercioSP sobre campos de 2027 (fonte secundária): <https://fecomercio.com.br/tributario/nfs-e-nacional-sera-obrigatoria-para-o-simples-a-partir-de-novembro/>
