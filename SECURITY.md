# Security policy

This policy covers the Corvo NFS-e frontend, API, worker, and deployment configuration.

**Report vulnerabilities privately**, never in a public issue: open a [private security advisory](https://github.com/corvo-technology/corvo-nfse/security/advisories/new) (repository **Security** tab, **Report a vulnerability**). If you cannot use GitHub, email contato@corvo.tech. Agree on disclosure with the maintainers before publishing exploitation details.

Include the affected version or commit, impact, and a minimal reproduction using fictional data. Exclude credentials, real certificates, fiscal documents, and customer information.

Production uses HTTPS, secure cookies, CSRF protection, tenant isolation through PostgreSQL RLS, and external S3 storage. Env files, certificates, and local state stay outside Git and image build contexts.

A supported-release policy has not been announced. The maintained version is the current code on the main branch.
