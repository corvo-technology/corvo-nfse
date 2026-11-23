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

## Web build variables

Next.js inlines `NEXT_PUBLIC_*` values into the browser bundle at build time. Supply them as build variables or Docker build args (`docker build -f deploy/Dockerfile.web --build-arg NEXT_PUBLIC_META_PIXEL_ID=... .`), or through Compose `web.build.args`. Setting runtime environment variables does not update these values; rebuild the image after changing them.

The web Docker build logs `NEXT_PUBLIC_META_PIXEL_ID`, `NEXT_PUBLIC_GA_ID`, and `NEXT_PUBLIC_API_URL` and fails if `NEXT_PUBLIC_META_PIXEL_ID` is empty. To intentionally build without Meta Pixel, pass `--build-arg ALLOW_MISSING_PIXEL=1`, or set `ALLOW_MISSING_PIXEL=1` in the Compose build environment (passed through by `web.build.args`). Next.js also warns about a missing pixel in production without failing the build.

## RTC calculator (Calculadora de Tributos)

The stack includes an internal `rtc-calculator` service (`Dockerfile.rtc`, Java 21). It is reachable only inside the Compose network, with no published ports. The image is built from the official open-source repository ([ReceitaFederal/calculadora-rtc-regime-regular](https://github.com/ReceitaFederal/calculadora-rtc-regime-regular), MIT license), so it does not depend on the government website. Nothing needs to be filled in: the version is pinned inside `Dockerfile.rtc` by two build arguments, `RTC_TAG` (the release tag) and `RTC_COMMIT` (its full commit). The build stops on purpose if the tag ever points to a different commit. The image keeps a copy of the project's license at `/app/LICENSE-calculadora-rtc.txt`.

The first build downloads Maven dependencies and creates the database from the repository's SQL files, so it takes a few minutes and needs about 3 GB of free disk. The pinned version (`app/db`, e.g. `1.6.1/V0059`) is also recorded in `rtc-pinned-version.txt`. To reproduce deploys exactly, publish the built image in your registry with the tag `rtc-<versaoApp>-<versaoDb>` and set `RTC_IMAGE` to it. After an update, run the smoke test: `RTC_URL=http://localhost:18080/api sh api/scripts/rtc-smoke.sh`.

The weekly `rtc-version-watch` workflow (`.github/workflows/rtc-version-watch.yml`) opens an issue when the repository publishes a tag newer than the pinned one. To update the calculator, follow the [calculator update runbook](../docs/fiscal/runbooks/rtc-update.md).
