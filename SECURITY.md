# Security policy

This policy covers the Corvo NFS-e frontend, API, worker, and deployment configuration. Public release and private reporting channels are still being prepared.

Report vulnerabilities privately to the repository maintainers. When GitHub Private Vulnerability Reporting is enabled, use the Security tab. Agree on disclosure before publishing exploitation details in a public issue.

Include the affected version or commit, impact, and a minimal reproduction using fictional data. Exclude credentials, real certificates, fiscal documents, and customer information.

Production uses HTTPS, secure cookies, CSRF protection, tenant isolation through PostgreSQL RLS, and external S3 storage. Env files, certificates, and local state stay outside Git and image build contexts.

A supported-release policy has not been announced. The maintained version is the current code on the main branch.
