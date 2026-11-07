# Contributing to Corvo NFS-e

Corvo NFS-e is licensed under [AGPL-3.0](LICENSE). By participating in the project, you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

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

Contributions to this repository are provided under the project's AGPL-3.0 license unless explicitly agreed otherwise with the maintainers.

Report community conduct incidents through the private contact listed in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Follow [SECURITY.md](SECURITY.md) for vulnerability reports.

## Sign your commits

Corvo NFS-e is licensed under the AGPL-3.0. By contributing you confirm you have the right to submit your work under that license, following the [Developer Certificate of Origin](https://developercertificate.org/). Please sign off your commits:

```bash
git commit -s -m "fix: describe the change"
```
