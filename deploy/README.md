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
