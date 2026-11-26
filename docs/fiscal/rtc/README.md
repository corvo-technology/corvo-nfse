# Calculadora de Tributos (RTC) — contrato verificado

Contrato verificado em 2026-10-15 (app `1.6.0`); fixtures recapturados em **2026-11-23** contra a instância **offline** (app `1.7.2`, dados `V0073`). Fonte do OpenAPI: `GET /api/api-docs` da própria instância (`openapi.json` nesta pasta). Fixtures reais em `fixtures/`.

## Distribuição e execução
- Código oficial: <https://github.com/ReceitaFederal/calculadora-rtc-regime-regular> (MIT). O `deploy/Dockerfile.rtc` clona uma tag fixa, gera o banco com `mvn flyway:migrate -Dflyway.configFiles=./flyway/flyway-pro.conf` e empacota o jar (o build usa a imagem oficial `maven:3.9-eclipse-temurin-25`, não o `./mvnw`, que baixava o Maven da internet e falhava às vezes; `target/api-regime-geral.jar`). Veja `docs/fiscal/runbooks/rtc-update.md`.
- Observação histórica: as capturas abaixo vieram do zip do governo (`piloto-cbs.tributos.gov.br`, `codigo-fonte-backend.zip`), que é o mesmo software (módulo `api-regime-geral`).
- Execução: `java -jar api-regime-geral.jar --spring.profiles.active=offline` na pasta que contém `calculadora/db/`. Porta **8080**, context-path **`/api`**. A imagem usa `eclipse-temurin:25-jre` (a 1.7.x exige Java 25; a 1.6.x usa 21, via `JAVA_VERSION` no Dockerfile).
- **Partida: ~4 min** (254 s medidos). Memória em regime: ~714 MiB. Latência de cálculo (warm): 25–440 ms.
- O site público (`piloto-cbs.tributos.gov.br`) fica atrás de WAF que rejeita rajadas ("Request Rejected"); nunca usar como dependência de produção nem em CI intensivo.
- Simples Nacional: o `regime-geral` só recebe o campo `OpcaoSimplesNacional` (1 não optante, 2 MEI, 3 ME/EPP, 4 optante pendente) em entradas que o aceitam. A Receita publica um componente à parte, `calculadora-rtc-simples-nacional` no mesmo repositório oficial da Receita (tag `1.0.2`). Ele precisa da alíquota efetiva do Simples da empresa (`aliquotasEfetivas`, vinda do PGDAS-D, ainda indisponível), usa campos da NT 009 cujo XSD não foi publicado e vale a partir de 2027. **Decidimos não integrar por enquanto**; veja [limitações](../limitations.md).

## Endpoints usados pela Corvo (todos sob `/api`)
| Uso | Método e caminho | Observações |
|---|---|---|
| Saúde/versão | `GET /calculadora/dados-abertos/versao` | `{versaoApp, versaoDb, dataVersaoDb, ambiente}`; versão da Corvo = `versaoApp/versaoDb` (ex.: `1.7.2/V0073`) |
| Base da NFS-e | `POST /calculadora/nfse/base-calculo` | `{anoFatoGerador*, valorServico*, descontoIncondicional, iss, pis, cofins, vCalcReeRepRes, vCalcDedRedIBSCBS}` → `{baseCalculo}`. PIS/COFINS proibidos a partir de 2027; ISS a partir de 2033. **Beta.** |
| Cálculo | `POST /calculadora/regime-geral` | `OperacaoInput`: `id*, versao*, dhFatoGerador, municipio*(IBGE int), uf, itens*[{numero*, nbs, cst*, cClassTrib*, baseCalculo, aliquotasNominais?}]` |
| NBS válidas | `GET /calculadora/dados-abertos/nbs/lista?data=` | 920 itens em 2026-12-10 `{codigo, descricao}` |
| CST × cClassTrib por NBS | `GET /calculadora/nfse/situacoes-classificacoes-tributarias?nbs=&data=` | lista de `{codigoSituacaoTributaria, codigoClassificacaoTributaria, …}` |
| Indicadores de operação | `GET /calculadora/nfse/indicador-operacao?dataOcorrenciaFatoGerador=&nbs=` | `{cIndOp, tipoOperacao, localFornecimento, localIncidencia, …}` |
| Validar cIndOp | `POST /calculadora/nfse/indicador-operacao/validate` | valida `cIndOp` × `cClassTrib` × `NBS` (× `cTribNac`); **capturar fixture na Task 4** |
| Local da operação | `GET /calculadora/nfse/local-operacao?cIndOp=&dataOcorrenciaFatoGerador=` | |
| Alíquotas de referência | `GET /calculadora/dados-abertos/aliquota-uniao|aliquota-uf|aliquota-municipio` | 404 `aliquota-nao-encontrada` para datas sem alíquota (ex.: 2027) |

## Mapeamento da resposta de `regime-geral` (fixtures `ok-*`)
`objetos[0].tribCalc.IBSCBS.gIBSCBS`:
- `vBC` (string) base; `vIBS` total do IBS (na 1.7.2, `vIBS = vIBSUF + vIBSMun` exibidos).
- `gCBS.{pCBS, vCBS, gRed.{pRedAliq, pAliqEfet}?, gDif?}`
- `gIBSUF.{pIBSUF, vIBSUF, gRed?, gDif?}`; `gIBSMun.{pIBSMun, vIBSMun, gRed?, gDif?}`
- `objetos[0].tribCalc.IBSCBS.memoriaCalculo.{cbs, ibsUF, ibsMun}`: desde a 1.7.0 a memória fica aqui, fora dos grupos (antes ficava em cada grupo). O mapper aceita os dois formatos.
- Arredondamento (1.7.2): cada valor publicado é arredondado uma vez e os totais são a soma dos itens exibidos (evita a rejeição 1091 da SEFIN). A Corvo não recalcula totais: usa os valores do motor.
- `objetos[0].calculoSimulado` (boolean): **`true` ⇒ a Corvo rejeita** (nunca aceita valor simulado).
- Totais em `total.tribCalc.IBSCBSTot`. Valores monetários e percentuais chegam como **strings**.

## Comportamentos que moldam o projeto
1. **2027+**: sem `aliquotasNominais` o motor responde **422** `aliquotas-nominais-nao-informadas` (a base dele não tem alíquotas de 2027). Com alíquotas informadas ele calcula, mas marca `calculoSimulado: true`. A Corvo **nunca** envia alíquotas estimadas ⇒ erro não retryable `TAX_RATE_NOT_FOUND`.
2. A **base de IBS/CBS** vem de `nfse/base-calculo` (ex.: 1000 − 100 desconto − 30 ISS = 870), não do valor bruto. Fluxo: base → regime-geral.
3. Catálogos não trazem vigência: as respostas valem para o parâmetro `data` informado ⇒ validação por consulta com a data da competência.
4. Erros vêm em `application/problem+json` (`type`, `title`, `status`, `detail`); classificar pelo sufixo de `type` (`classificacao-tributaria-nao-encontrada`, `aliquota-nao-encontrada`, `aliquotas-nominais-nao-informadas`).

## Reexecutar a captura
Subir o contêiner (ver Task 1 do plano 3), então `curl` com os corpos de `fixtures/*.json` (`steps[].request`) e comparar com `steps[].response`. Se a versão de `/versao` mudar, regenerar as fixtures e revisar as diferenças em PR.
