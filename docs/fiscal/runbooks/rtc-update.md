# Runbook: atualizar a Calculadora RTC

A Calculadora de Tributos é construída a partir do repositório oficial no GitHub (<https://github.com/ReceitaFederal/calculadora-rtc-regime-regular>, licença MIT), numa versão fixa. Isso evita depender do site do governo, cujo WAF derruba conexões do CI. A versão fica em dois lugares:

- `deploy/Dockerfile.rtc`: `ARG RTC_TAG` (a tag) e `ARG RTC_COMMIT` (o commit completo dessa tag). O build para se a tag passar a apontar para outro commit.
- `deploy/rtc-pinned-version.txt`: o registro legível, no formato `"{versaoApp}/{versaoDb}"` (ex.: `1.6.1/V0059`).

O workflow semanal `rtc-version-watch` abre um issue quando o repositório ganha uma tag mais nova que `RTC_TAG`. Este runbook descreve como atualizar com segurança.

## Passos

1. **Escolher a tag** em <https://github.com/ReceitaFederal/calculadora-rtc-regime-regular/tags> e ler o `CHANGELOG.md` dela. Se mudar arredondamento ou regra de cálculo, é decisão fiscal: avise antes de seguir.
2. **Pegar o commit completo da tag**:
   ```sh
   git ls-remote https://github.com/ReceitaFederal/calculadora-rtc-regime-regular 'refs/tags/<tag>'
   ```
   Veja a versão do banco (último `V00xx` em `flyway/sql/manutencao/` daquela tag) para o registro.
3. **Atualizar os pins** em um PR: `RTC_TAG` e `RTC_COMMIT` em `deploy/Dockerfile.rtc`, `deploy/rtc-pinned-version.txt` e `docs/fiscal/homologation.md` (novo teste de homologação com a versão).
4. **Construir e subir localmente** (precisa de uns 3 GB livres; o primeiro build leva alguns minutos):
   ```sh
   docker compose --env-file deploy/.env.local -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml build rtc-calculator
   ```
5. **Validar** antes de qualquer produção (a calculadora leva cerca de 4 minutos para subir):
   ```sh
   RTC_URL=http://localhost:18080/api sh api/scripts/rtc-smoke.sh
   cd api && RTC_CALCULATOR_URL=http://localhost:18080/api yarn jest rtc-integration
   ```
6. **Reexecutar a captura** (ver `docs/fiscal/rtc/README.md`): regenerar os fixtures sob `docs/fiscal/rtc/fixtures/` na versão nova e revisar o diff do `expected` no PR. Se os valores mudaram, é decisão fiscal explícita, não ruído.
7. **Publicar a imagem** (opcional, para deploys idênticos) com tag imutável `rtc-<versaoApp>-<versaoDb>` e apontar `RTC_IMAGE` para ela.

## Rollback

Voltar `RTC_TAG`, `RTC_COMMIT` e `rtc-pinned-version.txt` ao valor anterior (ou apontar `RTC_IMAGE` para a tag da imagem anterior) e reconstruir. Como a tag fica fixa no GitHub, o build volta a dar o mesmo resultado.

## Pendência: subir para a 1.7.2

A tag mais nova é a `1.7.2` (commit `32df7196356e81f2df08e6023fc2b6dbc48036d3`, banco V0073). Ela muda centavos: a alíquota efetiva passa a ter 4 casas, os totais viram a soma dos itens e `vIBS` = `vIBSUF` + `vIBSMun`. Isso pode alterar os fixtures e os valores esperados, então é uma decisão fiscal separada, seguindo os passos acima. Antes, ler os issues abertos #19 (ponteiro de anexo errado na tabela `NBS_APLICAVEL`, sem efeito no cálculo) e #20 (Imposto Seletivo somado em 2026 no endpoint `cbs-ibs-mercadorias`) do repositório oficial.
