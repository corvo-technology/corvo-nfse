# Docker deployment

This directory contains the Dockerfiles for the API, worker, and web application.

| File | Purpose |
| --- | --- |
| `docker-compose.yml` | Production stack with external S3 storage. |
| `docker-compose.local.yml` | Local override that adds LocalStack for testing. |
| `.env.example` | Production configuration template. |
| `.env.local.example` | Local configuration template. |
| `Caddyfile` | Optional HTTPS proxy for a VPS without its own hosting proxy. |

From the repository root, run `node scripts/setup-env.mjs` to generate the env files. Follow [the self-hosting guide](../SELF_HOSTING.md) to start either environment.

## RTC calculator (Calculadora de Tributos)

The stack includes an internal `rtc-calculator` service (`Dockerfile.rtc`, Java 21 + the official jar). It is reachable only inside the Compose network — no ports are published. Building it requires two variables:

- `RTC_ZIP_URL`: download URL of the official distribution zip. Obtain it with a **single** request (the public site has a WAF that rejects bursts): `curl -s 'https://piloto-cbs.tributos.gov.br/servico/calculadora-consumo/api/calculadora/download/url?platform=jar'` returns `{ "downloadUrl": "…/calculadora-jar.zip" }` — use that URL.
- `RTC_ZIP_SHA256`: SHA-256 of the pinned zip, recorded in [`docs/fiscal/rtc/ZIP_SHA256.txt`](../docs/fiscal/rtc/ZIP_SHA256.txt). The build fails on purpose if the published file changed (different hash): updating the calculator is an explicit decision.

The pinned calculator version (`app/db`, e.g. `1.6.0/V0059`) is recorded in `rtc-pinned-version.txt`. Because the government replaces the zip at the same URL, builds stop being reproducible after an update: publish the built image in your registry with the tag `rtc-<versaoApp>-<versaoDb>` (e.g. `rtc-1.6.0-V0059`), set `RTC_IMAGE` to that tag, and always deploy from the image instead of building locally. After an update, run the smoke test: `RTC_URL=http://localhost:18080/api sh api/scripts/rtc-smoke.sh`.

The weekly `rtc-version-watch` workflow (`.github/workflows/rtc-version-watch.yml`) opens an issue when the version published by the government differs from `rtc-pinned-version.txt`. To update the calculator, follow the [calculator update runbook](../docs/fiscal/runbooks/rtc-update.md).
