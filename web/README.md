# Corvo NFS-e — Web

Next.js 16/React 19 frontend with Tailwind CSS 4 and `next-intl`. Part of the [Corvo monorepo](../README.md).

The public website and API reference use `/en` and `/pt` routes. The dashboard lives at `/app` and includes companies, certificates, invoices, billing, webhooks, API keys, members, and settings. Sign-in uses an email code.

## Commands

```bash
yarn install --frozen-lockfile
yarn dev
yarn lint
yarn typecheck
yarn test
yarn build
yarn start
```

Development and `yarn start` use port `4000`. The standalone Docker container listens on internal port `3000`, mapped to host port `4000` in the local stack.

## Configuration

Use [.env.example](.env.example) for development outside Docker. Browser requests go to `/api/proxy/v1`. The proxy forwards them to `API_BASE_URL`, an origin without `/v1`. `APP_ORIGIN` must match the browser origin and is checked on mutations. Production uses HTTPS for secure session cookies.

The proxy forwards session cookies and CSRF headers and restricts allowed routes and methods. Integration API keys belong in external clients rather than browser code.

`SITE_ACCESS_MODE=open` enables login and dashboard routes. `coming-soon` keeps the site in prelaunch mode. The Docker stack enables the dashboard for self-hosting.

## Docker and tests

Run from the repository root:

```bash
docker build -f deploy/Dockerfile.web -t corvo-web:local web
```

The image uses Next.js standalone output. `yarn test:e2e` starts a production build on port `4100` and uses mocked API responses. Vitest covers the API client, proxy, authentication, documentation, and forms. See [SELF_HOSTING.md](../SELF_HOSTING.md) for the complete stack.
