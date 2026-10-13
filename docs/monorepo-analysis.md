# Corvo NFS-e monorepo consolidation review

## Architecture

One repository contains `api/`, `web/`, and `deploy/`. The API and worker share a NestJS application and use separate entry points. The Next.js frontend reaches the API through a same-origin proxy. Production keeps these three processes separate.

The consolidation uses [MillionSend](https://github.com/MillionSend/millionsend) as a reference for Compose installation, instance configuration, self-hosting documentation, and contribution guidelines. That project uses `apps/`, shared packages, pnpm, and Turborepo. Corvo keeps its existing application directories and lockfiles in this stage. Dependency workspaces and shared task caching are not configured yet.

## Findings and changes

| Finding | Change |
| --- | --- |
| Root Git plus two nested repositories | One Git repository; nested metadata moved outside the project. |
| No root setup or run commands | Root setup, dev, checks, local, and production commands. |
| Security workflow inside `api/.github` | Workflow moved to the root; application CI added. |
| WhatsApp/Greenflow READMEs and missing references | Documentation focused on the current NFS-e product. |
| Dockerfiles spread across applications | Three image definitions centralized in `deploy/`. |
| Referenced Sentry script missing | Release preparation and deployment script added. |
| Missing seed, Graphify extract, and hook files | Broken commands removed; Graphify resolved through PATH. |
| Temporary frontend name and Node 22 image | Frontend named `corvo-web`; Docker images aligned on Node 24. |
| Meta/WhatsApp credentials required for production startup | Unused requirements removed, with a regression test. |
| Test OTP secret used as production fallback | Production requires its own `OTP_HMAC_SECRET`. |

Nested Git directories were moved to `/private/tmp/corvo-nfse-git-backup.GhM2oE/api.git` and `web.git`. Root Git and its origin were preserved. The backup contains the previous history, refs, and index, but lives in a temporary system directory.

## Operations

- Production uses `deploy/docker-compose.yml`, external S3, and `NODE_ENV=production`.
- Local testing uses a LocalStack override, separate configuration, and separate volumes.
- API and worker wait for the migrations job and a healthy Redis service.
- The migrations job configures a runtime role without superuser or RLS bypass.
- The frontend proxy uses `http://api:3000`; public production origins use HTTPS.
- Caddy is optional. Dokploy or another existing proxy can handle HTTPS.
- PostgreSQL and Redis do not publish ports in the production stack.
- Setup generates secrets and preserves existing env files. Production preflight rejects placeholders and local configuration without displaying secret values.

## Verification during consolidation

| Check | Observed result |
| --- | --- |
| Application Git roots | Both resolve to the root repository; only one `.git` remains. |
| NestJS API/worker build | Passed, including compiled entry point verification. |
| Next.js build | Passed with Webpack; Turbopack hit a port restriction in the local environment. |
| Production TypeScript | Both applications passed. |
| Frontend Vitest | 10 files and 94 tests passed. |
| Existing backend Jest tests | 114 suites passed; the HTTP suite passed when rerun outside the sandbox. |
| Deployment configuration regression | 9 tests passed across deployment and email configuration suites. |
| Development shutdown | Failure exit code preserved; a descendant ignoring SIGTERM was terminated. |
| Production/local Compose | Both structures passed `config --quiet`. |
| Frontend ESLint | Passed. |
| Full backend ESLint | Existing baseline: 57 errors and 195 warnings. |
| Backend test TypeScript | Existing errors in outdated mocks; separate check command retained. |
| Complete Docker build | Image/dependency downloads failed due to network issues; full stack execution was not verified. |

The initial failures in the 19 HTTP tests were sandbox `listen EPERM` errors; all passed outside the sandbox. Ten integration suites with 76 tests require database configuration and were not run in this review. Real fiscal issuance, email delivery, and Stripe checkout were not exercised. Production configuration still requires the instance's actual URLs and external credentials.

Graphify supported architectural navigation, with findings checked against source files. The initial refresh refused to overwrite a graph with fewer nodes after files were removed; an explicit refresh updated both application graphs. The optional SQL extractor is not installed, so SQL findings were verified directly in the files.

## Follow-up work

1. Fix the existing lint baseline and typed mocks before making checks mandatory for merges. CI keeps these failures visible.
2. Validate images and the complete stack with stable registry access.
3. Add frontend/backend contract tests based on OpenAPI, covering response envelopes, pagination, documents, and fiscal errors.
4. Adopt a dependency workspace and one lockfile when shared packages are introduced; update imports, resolution, and Docker contexts together.
5. Review types, fields, and dependencies inherited from the previous product. This consolidation removed startup requirements while retaining optional integrations.
6. Establish private security reporting and define releases and published images before opening the project. AGPL-3.0 licensing and the Contributor Covenant 2.1 Code of Conduct have now been added.
