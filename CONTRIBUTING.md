# Contributing to Corvo NFS-e

Corvo is being prepared for an open source release. Maintainers still need to select a license and establish public contribution channels before publication.

## Set up your environment

Use Node.js 24, Yarn 1.22.22, and Docker Compose v2.

```bash
yarn setup
yarn local:up
```

The local stack uses `deploy/.env.local`, its own volumes, and LocalStack. Env files are ignored by Git; example files are versioned. Configure your email provider to test email-code sign-in.

For development watchers outside Docker, use the infrastructure Compose in `api/`, configure `api/.env` and `web/.env.local`, run migrations, and prepare the runtime role with `api/scripts/provision-runtime-role.sql`. Then run `yarn dev`. Use different ports if you run this alongside the complete Docker stack.

## Make a change

Keep fiscal rules in the backend and display HTTP contract errors in the frontend. Derive the tenant context from authentication and preserve permission checks and database isolation. Update frontend consumers and public examples together when the API contract changes.

```bash
yarn lint
yarn typecheck
yarn test
yarn build
```

`typecheck` covers production code. The backend provides `typecheck:tests` separately. Integration and E2E tests require their own setup and test databases. Unit tests do not verify real fiscal issuance, email delivery, or Stripe checkout.

Each application owns its `yarn.lock`. Install dependencies in the appropriate directory and update its lockfile. Keep a single Git repository at the root.

## Submit a pull request

Describe the problem, resulting behavior, and checks you ran. Include migration, configuration, and HTTP contract changes where relevant. Workflows belong in the root `.github/workflows/` directory.

Follow [SECURITY.md](SECURITY.md) for private vulnerability reports.
