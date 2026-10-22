# Diagnóstico de conformidade fiscal — Corvo

Data de corte: **22/10/2026**. Código de referência: **7aef844**.

## 1. Objetivo, método e limites

Definir o que precisa ser corrigido ou comprovado para os cenários de NFS-e que a Corvo suporta, preservando a arquitetura da FiscalEngine. Este documento não certifica todos os serviços, municípios ou regimes tributários brasileiros.

A revisão usa inspeção estática do código, contratos e testes existentes, documentação fiscal do repositório e consulta a fontes oficiais. Não foram executados testes nesta revisão, emissões, consultas a dados de produção, migrations ou alterações de configuração. A única alteração é este documento. Os registros anteriores de homologação não equivalem a testes executados agora.

Classificações:

- **Conforme:** evidência suficiente para o requisito específico indicado, não certificação global.
- **Parcialmente conforme:** mecanismo existente com cobertura limitada ou divergência identificada.
- **Não conforme:** comportamento demonstravelmente incompatível com o requisito técnico ou fiscal explicitado.
- **Não verificado:** falta evidência normativa, operacional ou teste conclusivo.

Os caminhos abaixo são relativos à raiz do repositório; as linhas referem-se ao commit indicado. Uma falha de consistência técnica não demonstra, por si só, que notas de produção já foram emitidas incorretamente.

## 2. Conclusão principal

Não há evidência de que seja necessário reconstruir a FiscalEngine. Há, porém, defeitos de integração entre entrada, persistência, cálculo e DPS que merecem prioridade antes de uma declaração de conformidade.

| Frente | Situação | Prioridade |
| --- | --- | --- |
| Preservação do desconto | Não conforme: o mapper busca o desconto no objeto errado | Alta |
| ISS retido do Simples | Não conforme: obrigação de retenção não produz valor retido local | Alta |
| Retenções federais na DPS | Parcialmente conforme: calculadas, mas não transportadas pelo builder | Alta |
| Base IBS/CBS de 2026 | Parcialmente conforme: adaptador omite PIS/Cofins admitidos no contrato | Alta nos cenários com esses tributos |
| Compatibilidade do leiaute | Não verificado por pacote/ambiente; não basta comparar nomes de versão | Alta |
| Transição outubro/dezembro | Parcialmente conforme: exceções não reconhecidas | Média |
| Precisão e conciliação | Parcialmente conforme: mecanismos presentes, comprovação incompleta | Média |
| Split Payment | Sem implementação específica identificada; obrigação aplicável não verificada | Não implementar por esta auditoria |

## 3. Arquitetura que deve ser preservada

O pipeline em `api/src/modules/invoice/application/fiscal/fiscal-steps.provider.ts:11` organiza perfil fiscal, classificação, aplicabilidade, tributos legados, RTC e validação. O cálculo não deve ser confundido com a autorização do documento.

1. O intake normaliza a solicitação e cria a nota.
2. `calculate-taxes.handler.ts` carrega a nota persistida, calcula e grava snapshot fiscal com encaminhamento da emissão.
3. `nfse-workflow.service.ts` monta o payload e controla transições e reconciliação de transmissões incertas.
4. `domain/fiscal/dps/dps-builder.ts` monta e valida a DPS pelo SDK.
5. `infra/external/nfse/open-nfse.provider.ts` assina/transmite, consulta DPS já enviada e reaproveita material pendente nos retries.
6. A autorização tem XML armazenado e origina eventos e conciliação fiscal.

Os caminhos abreviados acima pertencem a `api/src/modules/invoice/`. O ambiente interno `test` usa simulador; não é prova de aceitação pela SEFIN em produção restrita.

Decimal, snapshots, validação de catálogo e bloqueio de respostas RTC incompatíveis são mecanismos úteis. Seu uso não prova que os dados de entrada, a base tributável ou o enquadramento estejam corretos.

## 4. Problemas demonstráveis e critérios de aceite

### F01 — Desconto perdido na persistência

**Não conforme — consistência técnica.**

Evidências:

- `api/src/modules/invoice/domain/invoice.ts:146`: `serviceSnapshot` é construído sem desconto.
- `api/src/modules/invoice/domain/invoice.ts:156`: desconto é atribuído ao campo superior `discount`.
- `api/src/modules/invoice/infra/invoice.mapper.ts:102`: `toPersistence()` extrai `discount` de `snapshot.serviceSnapshot`, não de `snapshot.discount`.

O worker calcula a partir da nota recarregada. Assim, uma solicitação com desconto pode ter preview diferente do cálculo após persistência. O builder suporta desconto, mas não recupera um valor já perdido. A limitação também está registrada em `limitations.md`.

Critério de aceite: round-trip domínio → ORM → domínio preservando desconto; preview e processamento assíncrono devem usar a mesma base. Cobrir ausência, zero, desconto parcial, desconto igual ao bruto e rejeição de desconto maior que o bruto. Confirmar o desconto no XML final.

### F02 — Simples com ISS retido não calcula retenção local

**Não conforme — consistência técnica entre obrigação, resultado e DPS.**

Evidências:

- `api/src/modules/invoice/application/fiscal/strategies/simples-nacional-tax.strategy.ts:39`: exige `simplesIssRate` quando há retenção.
- Mesmo arquivo, linha 53: ISS fica `NOT_APPLICABLE`, por recolhimento no DAS.
- `api/src/modules/invoice/application/fiscal/steps/legacy-tax-calculator.step.ts:94`: só calcula ISS e seu valor retido quando `applicability.iss` é `REQUIRED`.
- `api/src/modules/invoice/domain/fiscal/dps/dps-builder.ts:261`: envia a alíquota efetiva do Simples quando a retenção é requerida.

Resultado: o cenário pode declarar retenção na DPS sem deduzi-la do líquido calculado localmente. Exemplo aritmético de aceite, não prova executada: serviço de R$ 1.000, sem desconto ou outras retenções, com retenção configurada de 3%, deve representar R$ 30 retidos e R$ 970 líquidos.

A LC 123, art. 21, § 4º, precisa orientar a alíquota e as condições de retenção; não usar automaticamente a alíquota municipal comum. Validar também início de atividade, ausência de informação e demais hipóteses aplicáveis antes de declarar cobertura integral.

### F03 — Retenções federais calculadas não são mapeadas para a DPS

**Parcialmente conforme.**

`legacy-tax-calculator.step.ts:119` calcula retenções federais configuradas e as usa no líquido. `dps-builder.ts:288` monta os parâmetros, mas não transporta `result.withholdings`; o bloco de valores em linha 324 não declara os respectivos valores federais.

Não se afirma que todas as operações exigem todas as retenções. A lacuna está no cenário em que o motor já decidiu calculá-las. Defaults do SDK não podem reconstruir valores que o builder não recebeu.

Critério de aceite: para cada retenção suportada, identificar hipótese legal, base, responsável, campo e condição do leiaute operacional; comprovar correspondência entre snapshot, DPS e XML autorizado. Incluir casos sem retenção. Tributo incidente, tributo retido e estimativa de carga tributária são conceitos distintos.

### F04 — Base RTC sem PIS/Cofins de 2026

**Parcialmente conforme; impacto depende da operação.**

`api/src/modules/invoice/infra/fiscal/rtc/default-rtc-mapper.ts:130` documenta exclusão de ISS, mas nunca PIS/Cofins; `toBaseRequest()` em linha 139 envia ano, valor, desconto e ISS.

Entretanto, `docs/fiscal/rtc/openapi.json:712` informa que PIS/Cofins deixam de ser aceitos a partir de 2027; o schema em linhas 6915 e 6921 admite ambos. O art. 12, § 2º, V, da LC 214 disciplina exclusões tributárias da base durante a transição.

Omitir os montantes não comprova erro em operações onde são zero, mas impede afirmar correção geral em 2026. Não preencher esses campos automaticamente com retenções de PIS/Cofins: retenção não equivale ao tributo incidente na operação.

Critério de aceite: definir a origem dos montantes incidentes, comparar casos com e sem esses tributos na RTC oficial e demonstrar a base esperada. Cobrir a mudança para 2027, sem enviar campos então incompatíveis. Revisar também deduções e reembolsos apenas nos cenários suportados.

### F05 — Município do ISS reutilizado no cálculo IBS/CBS

**Não verificado quanto à correção por cenário; acoplamento comprovado.**

`api/src/modules/invoice/application/fiscal/steps/rtc-tax-calculator.step.ts:237` usa `classification.iss.incidenceMunicipalityCode`, com fallback para município do serviço, no input RTC.

A LC 116, art. 3º, e a LC 214, art. 11, têm critérios próprios de localização. A igualdade entre os municípios não deve ser presumida universalmente. Falta comprovar casos de prestador, tomador e local de execução distintos, com o indicador de operação correto. Não se conclui que todas as operações atuais tenham município errado.

### F06 — Categoria específica de dezembro não reconhecida

**Parcialmente conforme.**

`api/src/modules/invoice/domain/fiscal/policies/rules/index.ts:46` contém as datas corretas, mas `specificCategoryServiceCodes` está vazio na linha 49. `tax-transition.policy.ts:95` decide a fase usando código/data.

O efeito é exigir antecipadamente dados de outubro para categorias com prazo de dezembro. Isso pode bloquear operações válidas; não é evidência de falta de exigência depois do prazo. O fallback foi deliberadamente registrado em `rules-verification.md`, mas continua sendo uma limitação.

Não basta preencher uma lista genérica: subitem LC 116, código nacional, NBS e natureza da operação não são equivalentes. Plataformas, intermediação, locações e condomínios exigem contexto adicional.

Critério de aceite: categorias justificadas por fonte e fatos da operação; testes nas vésperas e nos dias 01/10, 01/12 e 01/01/2027; combinação com regime tributário; decisão explícita quando faltarem dados de enquadramento.

## 5. Leiaute: separar publicação de implantação

O histórico oficial registra as mudanças de **20/10/2026 em produção restrita**, sem implantação correspondente indicada na coluna de produção. Portanto, o identificador `rtc-v1.01` não demonstra sozinho incompatibilidade com produção.

Referência: [Atualizações e implantações — Portal NFS-e](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/atualizacoes-e-implantacoes).

O código em `domain/fiscal/dps/dps-builder.ts:236` posiciona CST/cClassTrib dentro de `gIBSCBS`. O histórico anuncia reposicionamento em homologação. É uma diferença estrutural a investigar por ambiente, não uma razão para trocar apenas uma constante ou aplicar o schema de testes em produção.

Matriz ainda necessária:

| Item | Evidência exigida |
| --- | --- |
| Produção | ZIP oficial, hash, XSD e regras aceitos na data de implantação |
| Produção restrita | Pacote próprio e datas; diferenças em relação à produção |
| SDK instalado | Versão resolvida no lockfile e identificação dos schemas embarcados |
| Builder/DTO | Mapeamento de cada campo aplicável e condicionantes |
| Validação | XMLs de regressão contra cada pacote e casos reais autorizados |

Inspecionar `dps-layout.ts`, `dps-builder.ts`, `open-nfse.provider.ts`, DTOs e o pacote `open-nfse`. Não foi realizada aqui uma comparação integral de todos os XSDs oficiais.

Campos/grupos a classificar por cenário: `indFinal`, `cIndOp`, `indDest`/destinatário, CST/cClassTrib, condicionamento de `gIBSCBS`, ajustes de base e `gPgtoVinc`. Não assumir obrigatoriedade universal.

Outros limites visíveis no builder: tomador sem endereço no objeto transmitido (linha 336), `vTotTrib` zerado (linha 334) e regime de apuração do Simples fixado (linha 295). A aplicabilidade precisa ser confrontada com o cenário e o leiaute; esses fatos isolados não provam infração em toda nota. Informações de transparência tributária não devem ser confundidas com tributos devidos.

## 6. Matriz legal e temporal

| Fonte | Pergunta que deve fundamentar |
| --- | --- |
| LC 116/2003, arts. 2º, 3º, 6º e 7º | Incidência/exportação, município, responsabilidade e base ISS |
| LC 123/2006, especialmente art. 21, § 4º | Retenção do ISS do Simples e alíquota aplicável |
| LC 214/2025, arts. 11 e 12 | Local e base IBS/CBS, com exclusões aplicáveis |
| LC 214, arts. 31–36, com alterações | Relação fiscal/financeira e responsabilidades no Split Payment |
| LC 214, arts. 343, 346 e 348 | Regras de 2026 e condições da dispensa de recolhimento |
| LC 227/2026 | Alterações dos dispositivos pertinentes; ler redação consolidada e vigência |
| Ato Conjunto RFB/CGIBS 4/2026 e orientação CGNFS-e | Marcos de obrigatoriedade por operação |
| XSD, anexos e regras oficiais de cada ambiente | Sintaxe, campos condicionais e validações operacionais |

O cronograma distingue outubro (demais serviços sujeitos ao ISS) e dezembro (recortes de plataformas, subitens 1.03, 1.05, 1.09, 16.01 e outras categorias previstas). Simples possui prazo específico em janeiro de 2027. Tolerância de não rejeição até dezembro não significa dispensa geral da obrigação.

Fonte do cronograma: [Ato reproduzido no Portal Nacional NF-e](https://www.nfe.fazenda.gov.br/portal/informe.aspx?AspxAutoDetectCookieSupport=1&Informe=5JkxRSKBzcY%3D&ehCTG=false).

`collectionWaived: true` em `rules/index.ts:32` não verifica cumprimento de obrigações acessórias do contribuinte. Não apresentar esse booleano como comprovação individual de dispensa. A data de obrigação de usar o Emissor Nacional também não é automaticamente a mesma data de efeitos de IBS/CBS.

Leis federais não substituem legislação municipal, parametrização do município e confirmação do enquadramento real do contribuinte. Uma revisão fiscal especializada continua necessária para homologar cenários e exceções; não basta escolher alíquotas plausíveis.

## 7. Precisão, classificação, snapshot e conciliação

### Precisão

`domain/fiscal/money.ts` utiliza Decimal, mas `rules/index.ts:62` identifica HALF_UP com duas casas como convenção interna. A tolerância de R$ 0,01 em linha 71 também é interna. Não equivale a tolerância oficial de cada regra de rejeição.

Testar meia unidade de centavo, bases fracionárias, descontos, reduções, valores grandes, conversão Decimal → number nos adaptadores e somatório IBS estadual/municipal. Documentar em qual etapa ocorre cada arredondamento. Não alterar globalmente o arredondamento sem divergência demonstrada.

### Classificação e RTC

`domain/fiscal/classification/classify-service.ts` e `infra/fiscal/rtc/rtc-fiscal-catalog.ts` implementam resolução e consulta de classificações. Testar combinação real de serviço, NBS, CST, cClassTrib, cIndOp, competência e regime, não apenas existência isolada de cada código.

Exigir a RTC onde o cenário depende dela; não exigir indiscriminadamente para MEI/Simples de 2026. Configuração de produção efetivamente instalada não foi consultada. Disponibilidade da RTC, catálogo válido e capacidade de emitir são verificações distintas.

### Imutabilidade efetiva

Snapshot persistido é um bom mecanismo, mas `application/nfse-workflow.service.ts:336` relê perfil fiscal; linhas 428–429 fornecem ao builder regime especial e alíquota do Simples do perfil relido. Validar mudança de perfil entre cálculo e emissão: a DPS precisa representar a mesma decisão fiscal auditada, ou disparar recálculo explícito.

### Conciliação

`domain/fiscal/reconciliation/reconcile.ts:55` compara valores de ISS e IBS/CBS. Na linha 137, líquido é registrado, mas não integra a mesma comparação. Não há comprovação de conciliação integral de retenções, classificação e alíquotas.

Critério de aceite: fixtures anonimizadas de XML autorizado, valor esperado independente, identificação da versão RTC/schema/regra e diferenças por campo. Autorização SEFIN comprova aceitação, não correção tributária integral. Dados calculados, declarados e retornados devem permanecer distinguíveis.

## 8. Split Payment: situação e limites

Não foi identificada implementação específica de segregação tributária ou `gPgtoVinc` no fluxo de emissão. `externalId` da nota é uma referência genérica, não um contrato tipado de transação/liquidação. Cobrança Stripe da assinatura Corvo não equivale ao pagamento do serviço faturado pelo cliente.

Snapshots, XML armazenado e identificadores de nota são infraestrutura reaproveitável, mas não comprovam atendimento aos arts. 31–36. Não se pode atribuir à Corvo, apenas por emitir NFS-e, todas as responsabilidades de uma instituição de pagamento.

Antes de afirmar obrigação descumprida: identificar cenário, ato operacional, vigência e regra de vinculação aplicável. Ausência do grupo no produto não basta para classificar ilegalidade. **Este diagnóstico não propõe implementar Split Payment.**

## 9. Cobertura e evidências ainda necessárias

Há testes em `money.spec.ts`, `classification/classify-service.spec.ts`, `policies/tax-transition.policy.spec.ts`, `dps/dps-builder.spec.ts`, `reconciliation/reconcile.spec.ts`, `infra/invoice.mapper.spec.ts`, `infra/fiscal/rtc/default-rtc-mapper.spec.ts`, `infra/fiscal/rtc/rtc-fiscal-catalog.spec.ts` e `application/fiscal/steps/legacy-tax-calculator.step.spec.ts`, sob o módulo de invoice.

Existência de testes não comprova cobertura do cenário combinado nem execução bem-sucedida atual. Consultar também [homologation.md](homologation.md), [limitations.md](limitations.md) e [rules-verification.md](rules-verification.md); seus registros históricos não encerram as pendências acima.

Pacote mínimo de evidências para encerrar a revisão:

- Round-trip de desconto e paridade preview/worker/DPS.
- Simples com e sem retenção, incluindo líquido e alíquota efetiva.
- Retenções federais aplicáveis até o XML, não só no cálculo isolado.
- Base RTC de 2026 com PIS/Cofins incidentes e transição para 2027.
- Município ISS versus local IBS por operações representativas.
- Categorias e fronteiras de datas, com dados insuficientes tratados explicitamente.
- Schemas identificados separadamente para produção e restrita.
- XMLs autorizados anonimizados e conciliação com expectativa fiscal independente.
- Falha RTC, rejeição, timeout/retry e cancelamento sem duplicar documento ou perder evidência.

## 10. Ordem de trabalho recomendada, sem implementação nesta etapa

1. Delimitar matriz suportada: regimes, operações, municípios, retenções, descontos e competências.
2. Corrigir e testar defeitos demonstráveis de preservação de valores e retenções (F01–F03).
3. Comprovar bases e localização IBS/CBS (F04–F05) e compatibilidade por ambiente, em paralelo conceitual, sem reestruturar o motor.
4. Completar classificação temporal (F06), sem inventar correspondência de códigos.
5. Homologar precisão e conciliação por cenário; só então declarar conformidade daquele recorte.

Não liberar cenários complexos apenas porque passam pelo XSD. Operações ainda não suportadas devem permanecer explicitamente identificadas como tal. Não expandir automaticamente MEI/Simples 2027 ou Split Payment.

## 11. Fontes e rastreabilidade

Consultas oficiais realizadas em 22/10/2026; a análise não presume que qualquer texto publicado tenha efeitos imediatos.

- [LC 214/2025 — Planalto](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm). A captura integral pelo navegador falhou pelo tamanho; não se declara leitura integral nesta revisão.
- [Art. 12 da LC 214 — Senado](https://normas.leg.br/?urn=urn%3Alex%3Abr%3Afederal%3Alei.complementar%3A2025-01-16%3B214%21art12), conteúdo do dispositivo recuperado na busca oficial; aplicação exige JavaScript para abertura direta.
- [LC 227/2026 — Planalto](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp227.htm).
- [LC 116/2003 — Planalto](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp116.htm).
- [LC 123/2006 — Planalto](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm).
- [Histórico de implantação NFS-e](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/atualizacoes-e-implantacoes).
- [Documentação de produção](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual) e [produção restrita](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/producao-restrita): referências para a comparação de pacotes ainda pendente.
- [Acervo ctresb/leis](https://github.com/ctresb/leis): consultadas apresentação e organização de `federal/leis-complementares` por ano. Não foi usado como prova de redação vigente nem foi realizada comparação integral de suas cópias com o Diário Oficial.

Conclusão executiva: emissão e motor estão **parcialmente conformes no recorte analisado**, com defeitos técnicos identificados e validações fiscais pendentes. Não é possível afirmar “todas as notas corretas”. O caminho para essa garantia é fechar uma matriz explícita de cenários com norma, código, teste e XML de evidência para cada um.
