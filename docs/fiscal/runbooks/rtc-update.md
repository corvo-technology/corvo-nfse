# Runbook: atualizar a Calculadora RTC

A Calculadora de Tributos é construída a partir do repositório oficial no GitHub (<https://github.com/ReceitaFederal/calculadora-rtc-regime-regular>, licença MIT), numa versão fixa. Isso evita depender do site do governo, cujo WAF derruba conexões do CI. A versão fica em dois lugares:

- `deploy/Dockerfile.rtc`: `ARG RTC_TAG` (a tag), `ARG RTC_COMMIT` (o commit completo dessa tag) e `ARG JAVA_VERSION` (a do `java.version` do `pom.xml` da tag: 25 na 1.7.x, 21 na 1.6.x). O build para se a tag passar a apontar para outro commit.
- `deploy/rtc-pinned-version.txt`: o registro legível, no formato `"{versaoApp}/{versaoDb}"` (ex.: `1.7.2/V0073`).

O workflow semanal `receita-versions` (`scripts/check-receita-versions.sh`) abre um issue quando um dos 3 repositórios da Receita que acompanhamos ganha versão nova. Depois de atualizar, ajuste `RTC_TAG` em `deploy/Dockerfile.rtc` (regime-regular) ou `docs/fiscal/receita-versions.json` (DANFSe e Simples Nacional), senão o issue volta na próxima versão. Este runbook descreve como atualizar com segurança.

## Passos

1. **Escolher a tag** em <https://github.com/ReceitaFederal/calculadora-rtc-regime-regular/tags> e ler o `CHANGELOG.md` dela. Se mudar arredondamento ou regra de cálculo, é decisão fiscal: avise antes de seguir.
2. **Pegar o commit completo da tag**:
   ```sh
   git ls-remote https://github.com/ReceitaFederal/calculadora-rtc-regime-regular 'refs/tags/<tag>'
   ```
   Veja a versão do banco (último `V00xx` em `flyway/sql/manutencao/` daquela tag) para o registro.
3. **Atualizar os pins** em um PR: `RTC_TAG`, `RTC_COMMIT` e `JAVA_VERSION` em `deploy/Dockerfile.rtc`, `deploy/rtc-pinned-version.txt` e `docs/fiscal/homologation.md` (novo teste de homologação com a versão).
4. **Construir e subir localmente** (precisa de uns 3 GB livres; o primeiro build leva alguns minutos):
   ```sh
   docker compose --env-file deploy/.env.local -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml build rtc-calculator
   ```
5. **Validar** (o CI já sobe a calculadora e roda o smoke e o contrato a cada PR) antes de qualquer produção (a calculadora leva cerca de 4 minutos para subir):
   ```sh
   RTC_URL=http://localhost:18080/api sh api/scripts/rtc-smoke.sh
   cd api && RTC_CALCULATOR_URL=http://localhost:18080/api yarn jest rtc-integration
   ```
6. **Reexecutar a captura**: com a calculadora de pé, `RTC_URL=http://<ip>:8080/api node scripts/rtc-capture-fixtures.mjs` reescreve as respostas em `docs/fiscal/rtc/fixtures/` (veja `docs/fiscal/rtc/README.md`). Depois ajuste os campos `expected` à mão. Regenerar os fixtures sob `docs/fiscal/rtc/fixtures/` na versão nova e revisar o diff do `expected` no PR. Se os valores mudaram, é decisão fiscal explícita, não ruído.
7. **Publicar a imagem** (opcional, para deploys idênticos) com tag imutável `rtc-<versaoApp>-<versaoDb>` e apontar `RTC_IMAGE` para ela.

## Rollback

Voltar `RTC_TAG`, `RTC_COMMIT` e `rtc-pinned-version.txt` ao valor anterior (ou apontar `RTC_IMAGE` para a tag da imagem anterior) e reconstruir. Como a tag fica fixa no GitHub, o build volta a dar o mesmo resultado.
