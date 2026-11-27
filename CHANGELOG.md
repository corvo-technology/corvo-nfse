# Changelog

All notable changes to Corvo NFS-e. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
There are no tagged releases yet: the maintained version is the current code on `main`.

## Unreleased

### Added
- **NFC-e (venda ao consumidor), em teste.** A nota do balcão (modelo 65) pelas mesmas rotas `/v1/invoices` com `type: "nfce"`, no painel ("Venda ao consumidor"), no MCP e nas docs. QR Code v3, sem CSC; DANFCE em 80 mm e A4; cancelamento em até 30 minutos; sem carta de correção. Liberação própria por cliente, só em homologação e começando por SP.
- **Spreadsheet import.** Upload a CSV or Excel file, review the rows, fix the ones with problems and issue hundreds of invoices with live counters. Available in the dashboard, in the API (`/v1/imports`) and through MCP (`import_*` tools). Invoices that wait for credits can be issued again after a top-up (#133).
- **Scheduled and recurring invoices** with weekly, biweekly and monthly schedules, an e-mail on failures and MCP tools (#125).
- **Onboarding** for new accounts, step by step, in production (#130).
- Continue the DPS numbering of an existing company by informing the last number issued (#129).
- Test environment issues on the national Sefin's restricted production with the company certificate (#126).
- Stable API error codes, with texts in English and Portuguese (#127, #128).
- Stripe promotion codes at checkout (#136).

### Changed
- Transactional e-mails are built in code, with no templates to maintain in the e-mail provider's dashboard (#131).
- Payment integrations documentation restored, with the API reference and permissions (#139).

### Fixed
- CI: Docker build without the production-only Meta Pixel guard, API lint and the security scans (#139, #140).
