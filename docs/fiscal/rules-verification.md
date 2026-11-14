# Fiscal rules verification — `TAX_RULES` (Fiscal Engine, Task 7)

- **Date consulted:** 2026-10-14
- **Checked by:** Verboo Code agent (Task 7 implementation). Every quote below was extracted from the official text actually fetched on 2026-10-14 (Planalto consolidated texts, official CGIBS PDF, official gov.br portals). Nothing is marked "verified" unless its text was read.
- **Rule applied:** where an official value diverges from the plan's `TAX_RULES`, the official text wins.

Status legend: **VERIFIED** = text read and value confirmed. **NOT VERIFIED** = source not located/read; no claim made.

---

## 1. Rule `ibscbs.test-phase` — 2026 test-phase rates

**Source:** Planalto — Lei Complementar nº 214, de 16 de janeiro de 2025 (consolidated text, including amendments by LC 227/2026).
URL: `https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm` — consulted 2026-10-14.

| Item | Quote / article | Value |
|---|---|---|
| CBS 2026 rate | Art. 346: "Em relação aos fatos geradores ocorridos de 1º de janeiro a 31 de dezembro de 2026, a CBS será cobrada mediante aplicação da alíquota de 0,9% (nove décimos por cento)." | `cbsNominalPercent: '0.9'` — **VERIFIED** |
| IBS 2026 rate | Art. 343: "Em relação aos fatos geradores ocorridos de 1º de janeiro a 31 de dezembro de 2026, o IBS será cobrado mediante aplicação da alíquota estadual de 0,1% (um décimo por cento)." | `ibsNominalPercent: '0.1'` — **VERIFIED** |
| Dispensa de recolhimento | Art. 348, § 1º: "Fica dispensado o recolhimento do IBS e da CBS relativo aos fatos geradores ocorridos no período indicado no caput em relação aos sujeitos passivos que cumprirem as obrigações acessórias previstas na legislação." | `collectionWaived: true` — **VERIFIED** (with condition, see note 1.2) |
| Simples Nacional excluded from 2026 test rates | Art. 348, III, alínea "c": "não serão aplicadas em relação às operações dos contribuintes optantes pelo Simples Nacional." (within "As alíquotas do IBS e da CBS previstas nos arts. 343 e 346 desta Lei Complementar: …") | `excludesSimplesNacional: true` — **VERIFIED** |

Notes:

1. **(Divergence from the plan's Step-1 hypothesis) The dispensa is NOT in art. 458.** The plan asked "dispensa de recolhimento (LC 214 art. 458?)". Art. 458 of LC 214/2025 reads: "Os benefícios relativos às Áreas de Livre Comércio estabelecidos neste Capítulo aplicam-se até a data estabelecida pelo art. 92-A do ADCT." — it has nothing to do with the test phase. The correct provision is **art. 348, § 1º**. No code change required: the plan's `legalReference` for this rule is the generic `'LC 214/2025 (fase de teste 2026)'`, which is not contradicted by the official text.
2. **Condition on `collectionWaived` (kept, recorded for downstream tasks):** art. 348 § 1º waives collection only for taxpayers that comply with the accessory obligations ("que cumprirem as obrigações acessórias previstas na legislação"); § 2º keeps PIS/COFINS/CSLL obligations intact; § 3º (included by LC 227/2026) gives 60 days to cure accessory-obligation omissions. The encoded boolean `collectionWaived: true` is therefore true *per se*, but its legal conditionality lives outside the boolean.
3. **Terminology note:** the expression "fase de teste" (test phase) does **not** appear in LC 214/2025 (0 occurrences in the consolidated text). The normative heading of the applicable chapter is "Seção III — Disposições Comuns ao IBS e à CBS em 2026" (arts. 343–348). "Fase de teste" is the public/administrative name for the same 2026 period; the rule's `legalReference` string is kept exactly as the plan specifies.

**Result: no divergence in the values; `TAX_RULES['ibscbs.test-phase']` kept exactly as the plan.**

---

## 2. Rule `simples.ibscbs-effective` — Simples Nacional under IBS/CBS from 2027

**Sources and quotes (all consulted 2026-10-14):**

1. **Ato Conjunto RFB/CGIBS nº 4, de 30 de julho de 2026** (official PDF, `https://cgibs.gov.br/upload/arquivos/202607/31091735-20260730-16h30-ato-conjunto-rfb-cgibs-na-c2-ba-4-260731-090909.pdf`, linked from `https://cgibs.gov.br/atos-conjuntos`), art. 1º, § 1º: "No caso dos documentos fiscais eletrônicos de que trata o caput, a obrigatoriedade de emissão para os contribuintes optantes pelo Simples Nacional iniciar-se-á em relação aos fatos geradores que vierem a ocorrer a partir de 1º de janeiro de 2027." → **VERIFIED** (emission obligation for Simples starts 01/01/2027).
2. **LC 214/2025 with the annexes inserted/amended by LC 227/2026** (Planalto): the Simples Nacional annexes to LC 123 carry "(Vigência: 1º/1/2027 a 31/12/2028)" and their repartition columns already include **CBS and IBS** (e.g. "ANEXO II — Alíquotas e Partilha do Simples Nacional — Indústria (Vigência: 1º/1/2027 a 31/12/2028)" with IRPJ/CSLL/CBS/CPP/IBS columns). → **VERIFIED** (IBS/CBS integrate the Simples tables as of 01/01/2027).
3. **Official CGSN/RFB news**, "CGSN atualiza regras do Simples Nacional para adequação à Reforma Tributária do Consumo", published 12/08/2026 (`https://www8.receita.fazenda.gov.br/simplesnacional/Noticias/NoticiaCompleta.aspx?id=e595d010-1e04-4c3b-95d9-185fc58594b5`): "As Resoluções CGSN nº 190 e nº 191, de 2026 … dão continuidade ao processo de adaptação da Resolução CGSN nº 140, de 2018, às Leis Complementares nº 214, de 2025, e nº 227, de 2026." and "A Resolução CGSN nº 190 prevê que suas alterações produzirão efeitos, em regra, a partir de 1º de janeiro de 2027." → **VERIFIED**.
4. **CGNFS-e official orientation published 07/08/2026** (source in section 3), item 9: "Em 01/01/2027: … 9) para os optantes do Simples Nacional que optarem pelo destaque de IBS/CBS em setembro de 2026". → **VERIFIED**.

**Plan item "NFS-e do Simples 01/11/2026":** verified from official source — gov.br/NFS-e news "Comitê Gestor do Simples Nacional prorroga a obrigatoriedade de emissão de notas fiscais de serviço pelo Emissor Nacional da NFS-e", published 11/08/2026 (`https://www.gov.br/nfse/pt-br/noticias/comite-gestor-do-simples-nacional-prorroga-a-obrigatoriedade-de-emissao-de-notas-fiscais-de-servico-pelo-emissor-nacional-da-nfs-e`): "publicou a Resolução CGSN nº 191, de 4 de agosto de 2026, que altera o prazo de obrigatoriedade do uso do Emissor Nacional da Nota Fiscal de Serviço eletrônica (NFS-e) para os contribuintes optantes pelo Regime Especial Unificado … (Simples Nacional). Com a nova determinação, a exigência de emissão da NFS-e por meio do sistema nacional, que passaria a vigorar em 1º de setembro de 2026, foi adiada para 1º de novembro de 2026." (Context: Resolução CGSN nº 189/2026 had set 01/09/2026 — gov.br news 28/04/2026.) → **VERIFIED**.

**Value extracted:** `effectiveFrom: '2027-01-01'` — **VERIFIED**. Note this field encodes *when IBS/CBS effects reach Simples*, not the separate NFS-e emitter mandate of 01/11/2026 (that date does not appear in any `TAX_RULES` entry).

**Result: no divergence; `TAX_RULES['simples.ibscbs-effective']` kept exactly as the plan.**

---

## 3. Rule `nfse.ibscbs-information` — IBS/CBS information milestones in the NFS-e

**Source A — Ato Conjunto RFB/CGIBS nº 4, de 30 de julho de 2026** (official PDF on `cgibs.gov.br`, see URL above; signed by RFB Special Secretary and CGIBS President; "Estabelece as datas de início da obrigatoriedade de emissão dos documentos fiscais eletrônicos …"), art. 1º, III (NFS-e), quoted verbatim:

- a) "nos fornecimentos de serviços promovidos pelas plataformas digitais de que trata o § 1º do art. 22 da Lei Complementar nº 214 … bem como nos serviços por elas intermediados …: 1º de dezembro de 2026;"
- b) "nos fornecimentos de serviços também sujeitos ao ISS, enquadrados nos subitens 1.03, 1.05 e 1.09 da lista de serviços anexa à Lei Complementar nº 116 …: 1º de dezembro de 2026;"
- c) "nos fornecimentos de serviços também sujeitos ao ISS, enquadrados no subitem 16.01 da lista de serviços anexa à Lei Complementar nº 116 …: 1º de dezembro de 2026;"
- d) "nos fornecimentos de serviços também sujeitos ao ISS, enquadrados nos demais subitens da lista de serviços anexa à Lei Complementar nº 116 … não enquadrados nas alíneas anteriores deste inciso: **1º de outubro de 2026**;"
- e) "nos fornecimentos de bens imateriais não enquadrados na lista de serviços … e não sujeitos à incidência do ICMS …: 1º de dezembro de 2026;"
- f) "na cobrança de taxas e demais valores condominiais pelo condomínio edilício …: 1º de dezembro de 2026;"
- g) "nas locações de bens móveis ou imóveis …: 1º de dezembro de 2026;"
- h) "nos fornecimentos de serviços não enquadrados nas alíneas anteriores deste inciso: 1º de dezembro de 2026."

**Source B — CGNFS-e official orientation** (SE/CGNFS-e), news published **07/08/2026 08h45**, gov.br/NFS-e: "CGNFS-e orienta sobre os prazos para destaque de IBS/CBS nas notas fiscais de serviço", `https://www.gov.br/nfse/pt-br/noticias/cgnfs-e-orienta-sobre-os-prazos-para%20destaque-de-ibs-cbs-nas-notas-fiscais-de-servico`. Quotes:

- "Em 01/10/2026: … nos serviços sujeitos ao ISS e enquadrados nos demais subitens da lista de serviços anexa à LC 116 (alínea "d" do Ato Conjunto)" (general category).
- "Em 01/12/2026: 1) plataformas digitais …; 2) serviços … subitens 1.03, 1.05 e 1.09 …; 3) serviços … subitem 16.01 …; 4) fornecimentos de bens imateriais …; 5) … condomínio edilício …; 6) … locações …; 7) … demais fornecimentos de serviços não alcançados pelas categorias anteriores."
- Tolerance: "Até a data de 31/12/2026, e conforme as validações vigentes dos sistemas, a ausência ou omissão das informações relativas ao IBS e da CBS na NFS-e até 31 de dezembro de 2026 não acarretará a rejeição do documento fiscal pelo sistema nacional, se as informações exigidas nos campos obrigatórios constantes da estrutura do arquivo estiverem preenchidas."
- Simples: "Em 01/01/2027: … 9) para os optantes do Simples Nacional que optarem pelo destaque de IBS/CBS em setembro de 2026".

**Values extracted:**

| Field | Plan value | Official | Status |
|---|---|---|---|
| `generalFrom` | `'2026-10-01'` | 01/10/2026 (Ato 4, art. 1º, III, "d"; CGNFS-e) | **VERIFIED** |
| `specificCategoriesFrom` | `'2026-12-01'` | 01/12/2026 (Ato 4, art. 1º, III, "a"–"c" and "e"–"h"; CGNFS-e) | **VERIFIED** |
| `sefinToleranceUntil` | `'2026-12-31'` | "não acarretará a rejeição … até 31 de dezembro de 2026" (CGNFS-e 07/08/2026) | **VERIFIED** (semantic note below) |
| `specificCategoryServiceCodes` | `[]` (fallback if list not extractable) | see limitation 3.1 | **left empty — limitation recorded** |

Notes:

1. **3.1 — `specificCategoryServiceCodes` limitation (empty on purpose).** The official act defines the 01/12/2026 specific categories **by LC 116 subitem numbers** (1.03, 1.05, 1.09, 16.01) and **by operation nature** (digital platforms under LC 214 art. 22 §§ 1º/12–14, intangible goods outside the LC 116 list, condominium fees, leases), **not by 6-digit service codes** (cTribNac/NBS). No official publication read in this session maps those categories to a list of 6-digit service codes, so a verifiable code list could not be extracted. Per the plan's fallback rule the array stays `[]`. **Effect (conservative):** with an empty list, *every* service is treated as outside the specific categories and therefore follows the general rule (`generalFrom = 2026-10-01`) — i.e. the engine requires IBS/CBS information up to two months earlier than the deadline legally granted to the specific categories of Ato 4. This never under-requires information; it can only over-require it. Populating the list later requires an official 6-digit mapping source.
2. **Semantic note on `sefinToleranceUntil`:** the CGNFS-e orientation phrases the tolerance as *"absence/omission of IBS and CBS information does not cause document rejection by the national system until 31/12/2026, provided the required mandatory fields of the file structure are filled"* — i.e. a **non-rejection guarantee by the national system**, not an exemption from declaring the data. The encoded date `2026-12-31` matches; the field name ("toleratedBySefin") reflects this non-rejection behavior.
3. **Scope note:** Ato Conjunto RFB/CGIBS nº 4/2026 formally sets *"datas de início da obrigatoriedade de emissão dos documentos fiscais eletrônicos"* (art. 112 of RIBS/RCBS). The NFS-e IBS/CBS information groups follow the emission obligation, so the plan maps those emission dates to "information required from" dates. This mapping is the plan's interpretation and is consistent with the CGNFS-e 07/08/2026 orientation, which speaks directly of *inclusão e preenchimento das informações relativas ao IBS e da CBS* using the same dates.

**Result: no divergence in values; `TAX_RULES['nfse.ibscbs-information']` kept exactly as the plan (`specificCategoryServiceCodes: []` retained under the plan's own fallback with the limitation above).**

---

## 4. Rule `rounding.default` — `HALF_UP`, 2 places

**Status: NOT VERIFIED as law (deliberately).** No source in this task's Step-1 list fixes a rounding rule for NFS-e/IBS-CBS computation (LC 214/2025, LC 116/2003, LC 227/2026, Ato Conjunto nº 4/2026, CGNFS-e orientation and Resolução CGSN texts read here contain no rounding mandate for this context). `mode: 'HALF_UP'`, `places: 2` is therefore encoded as an **internal computational convention**, pending fiscal confirmation (the plan already flags it as pending confirmation). It is not represented as legally verified.

---

## 5. Base de cálculo / local de incidência (LC 116/2003) — read for Task 7 context (used by Task 12)

**Source:** Planalto — Lei Complementar nº 116, de 31 de julho de 2003. URL: `https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp116.htm` — consulted 2026-10-14.

- **Art. 7º:** "A base de cálculo do imposto é o preço do serviço." § 1º (proportional base for multi-municipality infrastructure services, subitem 3.04); § 2º, I: excludes "o valor dos materiais fornecidos pelo prestador dos serviços previstos nos itens 7.02 e 7.05 da lista de serviços anexa"; § 2º, II and § 3º are **VETADOS**. → **VERIFIED**.
- **Art. 3º:** "O serviço considera-se prestado, e o imposto, devido, no local do estabelecimento prestador ou, na falta do estabelecimento, no local do domicílio do prestador, exceto nas hipóteses previstas nos incisos I a XXV, quando o imposto será devido no local: …" → **VERIFIED** (local de incidência).

**Divergence from the plan's Step-1 wording (recorded):** the plan asks to check "LC 116 — base de cálculo / local de incidência (art. 7º desconto incondicional)". The word *"desconto"* does **not appear anywhere** in the official text of LC 116/2003 (0 occurrences in the consolidated text read on 2026-10-14) — art. 7º contains no unconditional-discount clause (its § 2º II and § 3º are vetoed). The explicit unconditional-discount rule for this reform lives in **LC 214/2025**:

- **Art. 12, § 2º, III:** "Não integram a base de cálculo do IBS e da CBS: … III - os descontos incondicionais;"
- **Art. 12, § 3º:** "Para efeitos do disposto no inciso III do § 2º deste artigo, considera-se desconto incondicional a parcela redutora do preço da operação que conste do respectivo documento fiscal e não dependa de evento posterior, inclusive se realizado por meio de programa de fidelidade concedido de forma não onerosa pelo próprio fornecedor."

**Resolution:** no `TAX_RULES` value of Task 7 depends on this (there is no discount rule in the four rules), so no code change here. **Task 12 (`FiscalTaxCalculator.deductUnconditionalDiscount`) must cite LC 214/2025, art. 12, § 2º, III and § 3º for IBS/CBS** (LC 116/2003 art. 7º remains the ISS base rule: "preço do serviço").

---

## 6. Summary table

| `ruleKey` / value | Plan value | Official value | Verdict |
|---|---|---|---|
| `ibscbs.test-phase.cbsNominalPercent` | `'0.9'` | 0,9% (LC 214, art. 346) | verified, no change |
| `ibscbs.test-phase.ibsNominalPercent` | `'0.1'` | 0,1% (LC 214, art. 343) | verified, no change |
| `ibscbs.test-phase.collectionWaived` | `true` | dispensa (LC 214, art. 348 § 1º, conditioned on accessory-obligation compliance) | verified, no change |
| `ibscbs.test-phase.excludesSimplesNacional` | `true` | Simples not subject to 2026 rates (LC 214, art. 348, III, "c") | verified, no change |
| `nfse.ibscbs-information.generalFrom` | `'2026-10-01'` | 01/10/2026 (Ato Conjunto RFB/CGIBS nº 4/2026, art. 1º, III, "d"; CGNFS-e 07/08/2026) | verified, no change |
| `nfse.ibscbs-information.specificCategoriesFrom` | `'2026-12-01'` | 01/12/2026 (idem, alíneas "a"–"c", "e"–"h") | verified, no change |
| `nfse.ibscbs-information.sefinToleranceUntil` | `'2026-12-31'` | non-rejection of NFS-e lacking IBS/CBS info until 31/12/2026 (CGNFS-e 07/08/2026) | verified, no change |
| `nfse.ibscbs-information.specificCategoryServiceCodes` | `[]` (fallback) | categories defined by LC 116 subitems/nature — no official 6-digit code list read | **empty retained, limitation recorded (3.1)** |
| `simples.ibscbs-effective.effectiveFrom` | `'2027-01-01'` | 01/01/2027 (Ato 4 § 1º; LC 214 annexes "Vigência: 1º/1/2027"; Resolução CGSN nº 190/2026; CGNFS-e item 9) | verified, no change |
| `rounding.default` | `'HALF_UP'`, `2` | no statutory source read | **not verified — internal convention, pending fiscal confirmation** |

**Divergences requiring action:** none in code (all `TAX_RULES` values match the official texts). Documentation divergences recorded: (i) dispensa article is **348 § 1º**, not 458; (ii) LC 116/2003 has **no** unconditional-discount clause — LC 214 art. 12 § 2º/§ 3º governs IBS/CBS; (iii) "fase de teste" is not LC 214's normative wording; (iv) specific-category 6-digit service code list not available from official sources → `specificCategoryServiceCodes: []`.

## Sources actually fetched (2026-10-14)

1. LC 214/2025 (Planalto): <https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm>
2. LC 116/2003 (Planalto): <https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp116.htm>
3. LC 227/2026 (Planalto): <https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp227.htm>
4. Ato Conjunto RFB/CGIBS nº 4/2026 (PDF oficial, CGIBS): <https://cgibs.gov.br/upload/arquivos/202607/31091735-20260730-16h30-ato-conjunto-rfb-cgibs-na-c2-ba-4-260731-090909.pdf> (index: <https://cgibs.gov.br/atos-conjuntos>)
5. CGNFS-e orientation 07/08/2026 (gov.br/NFS-e): <https://www.gov.br/nfse/pt-br/noticias/cgnfs-e-orienta-sobre-os-prazos-para%20destaque-de-ibs-cbs-nas-notas-fiscais-de-servico>
6. CGSN news 12/08/2026 — Resoluções CGSN nº 190/191 de 2026 (Portal do Simples Nacional / RFB): <https://www8.receita.fazenda.gov.br/simplesnacional/Noticias/NoticiaCompleta.aspx?id=e595d010-1e04-4c3b-95d9-185fc58594b5>
7. CGSN news 17/04/2026 — Resolução CGSN nº 186/2026 (Portal do Simples Nacional / RFB): <https://www8.receita.fazenda.gov.br/simplesnacional/Noticias/NoticiaCompleta.aspx?id=c739e03c-8482-473f-8e82-f38ec3b13637>
8. gov.br/NFS-e news 11/08/2026 — Resolução CGSN nº 191/2026 adia Emissor Nacional para 01/11/2026: <https://www.gov.br/nfse/pt-br/noticias/comite-gestor-do-simples-nacional-prorroga-a-obrigatoriedade-de-emissao-de-notas-fiscais-de-servico-pelo-emissor-nacional-da-nfs-e>
9. gov.br/NFS-e news 28/04/2026 — Resolução CGSN nº 189/2026 (01/09/2026): <https://www.gov.br/nfse/pt-br/noticias/nfs-e-e-simples-nacional-obrigatoriedade-de-emissao-atraves-do-emissor-nacional>
