# Runbook: atualizar a Calculadora RTC

A Calculadora de Tributos publica novas versões sem aviso: o zip oficial é substituído no mesmo endereço (aconteceu em 2026-10-14). A versão fixada vive em `deploy/rtc-pinned-version.txt` (formato `"{versaoApp}/{versaoDb}"`, ex.: `1.6.0/V0059`) e o hash em `docs/fiscal/rtc/ZIP_SHA256.txt`. O workflow semanal `rtc-version-watch` (`.github/workflows/rtc-version-watch.yml`) compara a versão publicada com a fixada e abre um issue quando divergem — este runbook descreve como atualizar com segurança.

Atenção: o site público fica atrás de um WAF que rejeita rajadas — **uma única requisição por tentativa**, com espaçamento entre elas, nunca rajadas.

## Passos

1. **Descobrir a versão publicada e baixar o zip** (uma requisição por tentativa):
   ```sh
   curl -s 'https://piloto-cbs.tributos.gov.br/servico/calculadora-consumo/api/calculadora/dados-abertos/versao'
   # → {"versaoApp": "...", "versaoDb": "..."}  — registre "{versaoApp}/{versaoDb}"

   curl -s 'https://piloto-cbs.tributos.gov.br/servico/calculadora-consumo/api/calculadora/download/url?platform=jar'
   # → {"downloadUrl": "…/calculadora-jar.zip"}

   curl -fL -o /tmp/calculadora-jar.zip '<downloadUrl>'
   shasum -a 256 /tmp/calculadora-jar.zip
   ```
2. **Reconstruir e publicar a imagem** com as variáveis novas e tag imutável:
   ```sh
   RTC_ZIP_URL='<downloadUrl>' RTC_ZIP_SHA256='<sha256-novo>' docker compose build rtc-calculator
   docker tag rtc-calculator rtc-<versaoApp>-<versaoDb>
   docker push <registry>/rtc-<versaoApp>-<versaoDb>
   ```
3. **Subir em staging e validar** antes de qualquer produção:
   ```sh
   RTC_IMAGE=rtc-<versaoApp>-<versaoDb> docker compose up -d rtc-calculator
   RTC_URL=http://localhost:18080/api sh api/scripts/rtc-smoke.sh
   cd api && RTC_CALCULATOR_URL=http://localhost:18080/api yarn jest rtc-integration
   ```
4. **Reexecutar a captura** (ver `docs/fiscal/rtc/README.md`): regenerar os fixtures sob `docs/fiscal/rtc/fixtures/` na versão nova e revisar o diff do `expected` no PR — se os valores mudaram, é decisão fiscal explícita, não ruído.
5. **Atualizar os pins** em um PR: `deploy/rtc-pinned-version.txt`, `docs/fiscal/rtc/ZIP_SHA256.txt` e `docs/fiscal/homologation.md` (novo teste de homologação com a versão).
6. **Promover**: `RTC_IMAGE=rtc-<versaoApp>-<versaoDb> docker compose up -d rtc-calculator` em produção, sempre a partir da imagem publicada — nunca rebuildando a partir do zip, que o governo substitui.

## Rollback

Se a versão nova divergir da Sefin ou o smoke test falhar, voltar à tag anterior da imagem (`rtc-<versaoApp>-<versaoDb>` anterior) e redesplegar com `RTC_IMAGE` — não é preciso rebaixar zip nem rebuildar. Depois, reverter os pins no commit seguinte.
