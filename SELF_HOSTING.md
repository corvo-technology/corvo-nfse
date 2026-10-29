# Self-hosting Corvo NFS-e

Run Corvo on your own infrastructure with Docker Compose. Use the local stack to explore the application, then configure production with your domains and external services.

## Choose an environment

| Environment | Compose files | Env file | Document storage |
| --- | --- | --- | --- |
| Production | `deploy/docker-compose.yml` | `deploy/.env` | External S3 bucket |
| Local testing | Main file + `deploy/docker-compose.local.yml` | `deploy/.env.local` | LocalStack |

Production and local stacks use separate project names and volumes: `corvo-nfse` and `corvo-nfse-local`. Both publish web and API on the same default host ports, so run one at a time or change the ports for one stack.

The local containers use `NODE_ENV=development` so browser sessions work over HTTP on localhost. The fiscal `test`/`live` setting is separate and uses the `x-corvo-environment` header.

## Generate your env files

Install Docker with Compose v2 and Node.js 24. Yarn is optional for Docker; install Yarn 1.22.22 if you want to use the root command shortcuts.

```bash
git clone https://github.com/corvo-technology/corvo-nfse.git
cd corvo-nfse
node scripts/setup-env.mjs
```

The setup creates these files only when they are missing:

| File | Used by |
| --- | --- |
| `deploy/.env` | Production Docker stack |
| `deploy/.env.local` | Local Docker stack |
| `api/.env` | Backend development outside Docker |
| `web/.env.local` | Frontend development outside Docker |

Passwords and internal signing/encryption keys are generated automatically. Files use permission `0600`; existing files are preserved. Fill in external credentials yourself. Keep the generated encryption keys with your backups: stored certificates and secrets depend on them.

## Local testing

```bash
docker compose --env-file deploy/.env.local \
  -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml \
  up -d --build --wait --wait-timeout 180
```

Open the dashboard at `http://localhost:4000` and the API reference at `http://localhost:4000/en/docs`. The API listens at `http://localhost:3000/v1`.

The stack includes web, API, worker, a migrations job, PostgreSQL, Redis, and LocalStack. LocalStack creates the `corvo-nfse` bucket automatically. Its endpoint is `http://s3.localhost.localstack.cloud:4566`; the Compose network provides that hostname as an alias, and it resolves to localhost from the host.

### Email and billing

Local services can start with the generated configuration. Signing in by email code and sending documents require real email credentials. Add these to `deploy/.env.local`:

```dotenv
RESEND_API_KEY=your_email_provider_api_key
RESEND_BASE_URL=https://api.millionsend.com
EMAIL_FROM=Corvo <noreply@yourdomain.com>
```

Use a sender authorized by your provider. To test billing, replace `STRIPE_SECRET_KEY` and `STRIPE_PLATFORM_WEBHOOK_SECRET` with your Stripe test credentials. The local placeholder values only allow startup.

Rerun `up` after changing an env file. With Yarn, the shortcuts are `yarn local:up`, `yarn local:logs`, and `yarn local:down`.

## Production

Edit `deploy/.env` using [the production example](deploy/.env.example).

| Setting | What to enter |
| --- | --- |
| `APP_ORIGIN` | Public HTTPS frontend origin, without a path or trailing slash. |
| `PUBLIC_API_URL` | Public HTTPS API origin, without `/v1` or a trailing slash. |
| `STORAGE_S3_BUCKET` | Name of an existing bucket. |
| `STORAGE_S3_ENDPOINT` | External HTTPS endpoint for your S3 service. |
| `STORAGE_S3_REGION` | Region expected by your S3 service. |
| `STORAGE_S3_ACCESS_KEY_ID` / `STORAGE_S3_SECRET_ACCESS_KEY` | Credentials that can access the bucket. |
| `RESEND_API_KEY` / `RESEND_BASE_URL` | Email provider credentials and API endpoint. |
| `EMAIL_FROM` | Sender authorized by the email provider. |
| `STRIPE_SECRET_KEY` | Stripe secret key for your instance. |
| `STRIPE_PLATFORM_WEBHOOK_SECRET` | Signing secret for your Stripe webhook. |

The setup already generates PostgreSQL passwords, session/OTP signing secrets, and certificate encryption keys. Generated passwords use hexadecimal so they can be embedded safely in connection URLs.

### Social sign-in (optional)

The login screen offers Google and GitHub when the API has all three values of a provider: `<PROVIDER>_CLIENT_ID`, `<PROVIDER>_CLIENT_SECRET` and `<PROVIDER>_REDIRECT_URL`. Without them the buttons stay disabled and the email code still works.

The redirect URL goes through the dashboard, so the session cookie belongs to the dashboard origin. Register exactly this URL in the provider console:

| Provider | Redirect (callback) URL |
| --- | --- |
| Google | `https://<WEB_DOMAIN>/api/proxy/v1/auth/oauth/google/callback` |
| GitHub | `https://<WEB_DOMAIN>/api/proxy/v1/auth/oauth/github/callback` |

Only a verified provider email signs a user in or links an existing account.

Optional settings include `STRIPE_PORTAL_CONFIGURATION_ID`, Turnstile credentials for endpoints that use it, Sentry, and OpenTelemetry. Keep `TURNSTILE_DEVELOPMENT_BYPASS_ENABLED=false` in production. The current email-code login does not use Turnstile.

```bash
node scripts/check-deploy-env.mjs
docker compose --env-file deploy/.env -f deploy/docker-compose.yml config --quiet
docker compose --env-file deploy/.env -f deploy/docker-compose.yml \
  up -d --build --wait --wait-timeout 180
```

The preflight reports missing variable names without printing secret values. With Yarn, use `yarn deploy:config` and `yarn deploy:up`.

### Network and storage

PostgreSQL and Redis stay inside the Compose network. The API and worker use a restricted runtime database role, separate from the schema owner used by migrations.

Production uses an external S3 bucket. The endpoint must also be reachable by clients receiving signed download URLs. LocalStack is only defined in the local override.

### HTTPS with Dokploy or another hosting proxy

Route the frontend domain to service `web`, internal port `3000`, and the API domain to service `api`, internal port `3000`. Enable HTTPS in your hosting platform. The worker does not need a public domain.

The frontend reaches the backend internally through `http://api:3000`. Browser requests go through the frontend's same-origin API proxy. `APP_ORIGIN` must match the public browser origin exactly so mutations pass the origin check and secure session cookies work.

### HTTPS on a VPS with Caddy

For a VPS without an existing proxy, configure `WEB_DOMAIN` and `API_DOMAIN` to match your public origins. Point their DNS records at your server and allow ports 80 and 443. Then enable the optional `proxy` profile:

```bash
node scripts/check-deploy-env.mjs --proxy
docker compose --env-file deploy/.env -f deploy/docker-compose.yml \
  --profile proxy up -d --build --wait --wait-timeout 180
```

`deploy/Caddyfile` routes each domain to its application. Caddy obtains and renews TLS certificates and redirects HTTP to HTTPS. Certificate data is stored in persistent volumes. See [Caddy's automatic HTTPS requirements](https://caddyserver.com/docs/automatic-https).

### External integrations

Email login codes and invoice attachments use your email provider. Billing uses your Stripe account; its webhook endpoint is `/v1/webhooks/stripe` on your public API domain. WhatsApp/Meta credentials are not required to start the NFS-e application.

## Migrations and updates

On initial startup, the `migrations` service runs once, applies database migrations, and prepares the runtime role and permissions. API and worker wait for it to finish successfully. Migrations do not run inside either application's startup command.

Before updating, back up PostgreSQL, your S3 documents, and the encryption keys. Apply a new version from the repository root:

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml build
docker compose --env-file deploy/.env -f deploy/docker-compose.yml stop api worker web
docker compose --env-file deploy/.env -f deploy/docker-compose.yml run --rm migrations
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --wait
```

Include `--profile proxy` if you use Caddy. Editing the PostgreSQL password in an env file does not change the password stored in an existing database volume. `down` keeps volumes; `down -v` deletes them.

### Invoice cancellation release

This release adds NFS-e cancellation. The API now writes `invoice.cancel` outbox messages, and a worker from an older version has no handler for them (`No outbox handler`), which leaves the invoice stuck in `cancelling`. Always update and restart the worker before, or together with, the API; the update procedure above rebuilds and starts both from the same version.

The `AddInvoiceCancellation` migration cannot be rolled back while any invoice is `cancelling` or `cancelled`: the rollback fails with an error naming how many exist, because mapping them back to `authorized` would falsify their fiscal state. Resolve those invoices first, or restore from your backup.

## Troubleshooting

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml ps -a
docker compose --env-file deploy/.env -f deploy/docker-compose.yml logs --tail=100 migrations
docker compose --env-file deploy/.env -f deploy/docker-compose.yml logs --tail=100 api worker
```

A migrations job that exits with code `0` completed successfully. API liveness is `/v1/health/live`; readiness is `/v1/health/ready`. The worker exposes the same paths on internal port `3002`.

Storage readiness checks configuration rather than performing a bucket upload. Verify a document upload and download with your S3 credentials before using the instance for real invoices.
