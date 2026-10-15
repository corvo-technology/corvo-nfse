# FiscalEngine — Limitações e cenários não homologados (Plano 2 / Spec 2)

Data: 2026-10-14 · Escopo: núcleo da FiscalEngine (`feat/fiscal-engine-core`).

Este documento registra, de forma explícita, o que **ainda não foi homologado**
neste estágio e quais decisões seguem pendentes de confirmação humana. Nada
aqui foi validado contra a **Calculadora RTC oficial** nem contra o ambiente de
**Produção Restrita** da NFS-e nesta etapa.

## 1. Cenários bloqueados / não exercitados de ponta a ponta

| Cenário | Situação | Motivo |
| --- | --- | --- |
| **IBS/CBS no regime regular (2026), modo `block`** | Bloqueado por design | O adaptador **real** da Calculadora RTC é o Spec 3 (fora do escopo do Plano 2). A porta está ligada a `UnconfiguredRtcCalculator`, que devolve `TAX_CALCULATION_UNAVAILABLE`. Em modo `block` a emissão é recusada até o adaptador real existir. |
| **Simples Nacional / MEI em 2027 (opção pelo regime regular)** | `UNSUPPORTED` | As regras de transição para 2027 (Simples com IBS/CBS efetivos) ainda não têm os valores oficiais carregados. O motor bloqueia explicitamente (`TAX_CALCULATION_UNSUPPORTED`) até as regras serem carregadas — nunca degrada para `NOT_APPLICABLE`. |
| **ISS com regime `FIXED`** | Não exercitado | O resolvedor de ISS trata `NORMAL`/`EXEMPT`; o caso `FIXED` (alíquota fixa municipal) precisa da tabela/alíquota do município e de homologação contra o município de referência. |
| **Salão-parceiro (`PARTNER_SALON`)** | `FISCAL_REVIEW_REQUIRED` | A regra do Ato Conjunto RFB/CGIBS nº 4/2026 para salões de beleza com parceiros exige conferência das alíneas/ofícios específicos. O motor marca revisão manual em vez de presumir classificação. |
| **Mercadorias / operação `GOODS`/`MIXED`** | `OPERATION_DOCUMENT_UNSUPPORTED` | O Plano 2 cobre **serviços** (LC 116). Operações com mercadoria (`GOODS`) ou mistas (`MIXED`) exigem o módulo de produtos/NCM e ficam bloqueadas até um plano específico. |

## 2. O que NÃO foi homologado nesta etapa

- **Nenhum cenário** foi executado contra a **Calculadora RTC oficial** (adaptador real = Spec 3).
- **Nenhum cenário** foi executado contra a **Produção Restrita** da NFS-e nacional.
- Os valores de **2026** (CBS 0,9% / IBS 0,1%, dispensa de recolhimento) foram lidos das fontes oficiais (LC 214/2025 art. 343/346/348) e registrados em `docs/fiscal/rules-verification.md`, mas **não** validados fim a fim pelo sistema nacional.
- **Arredondamento**: a convenção interna (`HALF_UP`, 2 casas) não tem respaldo estatutário lido — é convenção de código pendente de confirmação fiscal.
- **`specificCategoryServiceCodes`** (categorias específicas do Ato Conjunto RFB/CGIBS nº 4/2026) ficou **vazio**: o ato define as categorias por **subitens da LC 116** (1.03, 1.05, 1.09, 16.01) e por natureza da operação, não por códigos cTribNac de 6 dígitos. Efeito: todos os serviços seguem a regra **geral** a partir de 01/10/2026 (conservador — nunca sub-exige).

## 3. Decisões humanas pendentes

- **D1 — `FISCAL_IBSCBS_UNAVAILABLE_MODE`**: manter `block` (padrão atual, não emite sem IBS/CBS) ou operar em `warn` (emite com warning durante a tolerância até 31/12/2026)? Definição de operação, não de código.
- **D2 — Aprovação de perfil fiscal em produção**: quem pode `approve` um `company_fiscal_profile` / `company_service_tax_profile` no ambiente `live` (papel/`RequirePermission`)? Hoje o fluxo existe mas o papel autorizado não está definido.
- **D3 — Categorias específicas do Ato Conjunto nº 4/2026**: confirmar a lista de subitens/naturezas que mudam de regra em 01/12/2026 e mapeá-los para códigos internos quando houver equivalência oficial.

## 4. Fora de escopo deste plano (planos seguintes)

Adaptador HTTP real da Calculadora RTC, DpsBuilder com grupo IBSCBS completo,
conciliação fiscal, preview de impostos, catálogos NBS/CST/cClassTrib/cIndOp,
permissões novas.
