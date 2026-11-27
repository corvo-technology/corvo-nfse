# Docker deployment

This directory contains the Dockerfiles for the API, worker, and web application.

| File | Purpose |
| --- | --- |
| `docker-compose.yml` | Production stack with external S3 storage. |
| `docker-compose.local.yml` | Local override that adds LocalStack for testing. |
| `.env.example` | Production configuration template. Sets `DEPLOYMENT_MODE=self_hosted` (billing off). |
| `.env.local.example` | Local configuration template. |
| `Caddyfile` | Optional HTTPS proxy for a VPS without its own hosting proxy. |

From the repository root, run `node scripts/setup-env.mjs` to generate the env files. Follow [the self-hosting guide](../SELF_HOSTING.md) to start either environment.

## Platform admin

`OPS_ALERT_EMAILS` (in `.env`, comma-separated) lists who is e-mailed when the servers cannot reach the government NFS-e portal. Every minute the worker opens a TLS connection to `sefin.nfse.gov.br`, `adn.nfse.gov.br`, `www.gov.br` and a control host outside the government (`PORTAL_PROBE_CONTROL_HOST`, default `1.1.1.1`); it only checks it can connect, with no certificate and no request. Three bad checks in a row open the alert, two good ones close it; each incident sends one "down" e-mail and one "recovered" e-mail. Real emissions that fail to connect (`OPS_ALERT_EMISSION_FAILURES` in 10 minutes, default 10, 0 = off) raise the same alert. The worker must be able to send e-mail (`RESEND_API_KEY`). Turn it all off with `PORTAL_PROBE_ENABLED=false`.

`TEST_QUEUE_CONCURRENCY` (in `.env`, default 2, 1 to 10) is how many test (homologação) jobs each `*-test` queue runs at once per worker. Test notes use their own queues, so a big test run never delays production. Nothing to migrate: jobs already in the old queues finish normally.

`PLATFORM_ADMIN_EMAILS` (in `.env`, comma-separated, lowercase, no spaces) lists who can open `/app/admin`. Empty or missing means nobody is admin. The e-mail must be verified, and only a cookie session counts (API keys and MCP never are admin). The list is read at startup: restart the API after changing it. In self-hosted mode the credit grant does not exist.

## Data cleanup

The worker runs a daily purge (04:00, São Paulo) of finished outbox rows. It starts as a dry run: with `DATA_RETENTION_ENABLED=false` (the default) it only counts and logs what it would delete (log lines with `event=data_retention`, fields `rule`, `matched`, `deleted`). After a week of logs, set `DATA_RETENTION_ENABLED=true` on the worker to delete. Rules: `api/src/modules/invoice/infra/typeorm-outbox-retention.ts`.

New Redis jobs expire by themselves. Jobs created before that change stay forever; clean them once after updating (inside the running container, from the repository root). The first command is a dry run that only counts; the second deletes old finished jobs:

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec worker node scripts/queue-clean.mjs
docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec worker node scripts/queue-clean.mjs --apply
```

## NF-e

NF-e and NFC-e are open to every workspace in test (homologação), with nothing to release. Production stays blocked (`422 NFE_PRODUCTION_DISABLED`) until `NFE_PRODUCTION_ENABLED=true`, the only switch. To go live set it to `true` on the api, the worker and the web: the web only uses it to swap the "test, production soon" notes on `/nf-e`, `/nfc-e` and the home FAQ for the production text (read at runtime, no rebuild; the pages refresh within a minute). `NFE_ENABLED` no longer exists: remove it from your environment. `NFE_TEST_PROVIDER` (`sefaz` or `fake`) and `NFE_SEFAZ_TIMEOUT_MS` are optional.

## Web build variables

Next.js inlines `NEXT_PUBLIC_*` values into the browser bundle at build time. Supply them as build variables or Docker build args (`docker build -f deploy/Dockerfile.web --build-arg NEXT_PUBLIC_META_PIXEL_ID=... .`), or through Compose `web.build.args`. Setting runtime environment variables does not update these values; rebuild the image after changing them.

The Compose file already sets `ALLOW_MISSING_PIXEL=1`, so the web builds without a Meta Pixel unless you set `NEXT_PUBLIC_META_PIXEL_ID` in `deploy/.env`. The web Docker build logs `NEXT_PUBLIC_META_PIXEL_ID`, `NEXT_PUBLIC_GA_ID`, and `NEXT_PUBLIC_API_URL` and fails if `NEXT_PUBLIC_META_PIXEL_ID` is empty. To intentionally build without Meta Pixel, pass `--build-arg ALLOW_MISSING_PIXEL=1`, or set `ALLOW_MISSING_PIXEL=1` in the Compose build environment (passed through by `web.build.args`). Next.js also warns about a missing pixel in production without failing the build.

## RTC calculator (Calculadora de Tributos)

The stack includes an internal `rtc-calculator` service (`Dockerfile.rtc`, Java 25). It is reachable only inside the Compose network, with no published ports. The image is built from the official open-source repository ([ReceitaFederal/calculadora-rtc-regime-regular](https://github.com/ReceitaFederal/calculadora-rtc-regime-regular), MIT license), so it does not depend on the government website. Nothing needs to be filled in: the version is pinned inside `Dockerfile.rtc` by two build arguments, `RTC_TAG` (the release tag) and `RTC_COMMIT` (its full commit). The build stops on purpose if the tag ever points to a different commit. The image keeps a copy of the project's license at `/app/LICENSE-calculadora-rtc.txt`.

The first build downloads Maven dependencies and creates the database from the repository's SQL files, so it takes a few minutes and needs about 3 GB of free disk. The pinned version (`app/db`, e.g. `1.7.2/V0073`) is also recorded in `rtc-pinned-version.txt`. To reproduce deploys exactly, publish the built image in your registry with the tag `rtc-<versaoApp>-<versaoDb>` and set `RTC_IMAGE` to it. After an update, run the smoke test: `RTC_URL=http://localhost:18080/api sh api/scripts/rtc-smoke.sh`.

The weekly `receita-versions` workflow (`.github/workflows/receita-versions.yml`) opens an issue when a tracked Receita repository publishes a newer version. To update the calculator, follow the [calculator update runbook](../docs/fiscal/runbooks/rtc-update.md).
