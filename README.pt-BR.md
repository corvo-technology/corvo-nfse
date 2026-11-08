<p align="center">
  <img src="web/public/brand/corvo-faceted-green.png" alt="Logo do Corvo" width="160" />
</p>

<p align="center">
  <strong>Notas fiscais de serviço (NFS-e) brasileiras, dentro do seu produto.</strong>
</p>

<p align="center">
  <a href="LICENSE"><img alt="Licença: AGPL-3.0-only" src="https://img.shields.io/badge/license-AGPL--3.0--only-blue" /></a>
  <img alt="Node.js 24" src="https://img.shields.io/badge/node-24-339933" />
  <img alt="TypeScript" src="https://img.shields.io/badge/typescript-strict-3178c6" />
</p>

<p align="center">
  <a href="README.md">English</a> · <strong>Português (Brasil)</strong>
</p>

O Corvo é uma API REST e um servidor MCP para emitir NFS-e no padrão nacional, com foco em empresas **MEI e Simples Nacional**. Ele cadastra as empresas emissoras, guarda os certificados A1, calcula os tributos antes de emitir, processa cada nota em segundo plano, guarda o PDF e o XML e avisa cada mudança de status por webhook. O painel e os agentes de IA (Claude Code, Cursor, Codex e outros) usam a mesma API.

[Início rápido](#início-rápido) · [Usar a API](#usar-a-api) · [Agentes de IA](#agentes-de-ia-mcp) · [Deploy](#deploy-em-produção) · [Desenvolver](#desenvolver) · [Documentação](#documentação) · [Contribuir](CONTRIBUTING.md)

## Conteúdo

- [O que você pode fazer](#o-que-você-pode-fazer)
- [Como funciona](#como-funciona)
- [Início rápido](#início-rápido)
- [Usar a API](#usar-a-api)
- [Agentes de IA (MCP)](#agentes-de-ia-mcp)
- [Deploy em produção](#deploy-em-produção)
- [Desenvolver](#desenvolver)
- [Estrutura do repositório](#estrutura-do-repositório)
- [Documentação](#documentação)
- [Aviso legal](#aviso-legal)
- [Comunidade e licença](#comunidade-e-licença)

## O que você pode fazer

| Recurso | O que oferece |
| --- | --- |
| API de notas | Emita notas fiscais de serviço eletrônicas a partir do seu SaaS, ERP ou backend. A emissão é assíncrona e segura para repetir com `Idempotency-Key`. |
| Cálculo de tributos | `POST /v1/invoices/calculate` mostra ISS, retenções e IBS/CBS (quando se aplicam) antes de emitir, sem criar nota e sem gastar crédito. |
| Notas agendadas e recorrentes | Emita numa data futura (`options.type: "SCHEDULE"`) ou numa agenda semanal, quinzenal ou mensal (`"RECURRING"`). |
| Cancelamento | `POST /v1/invoices/:id/cancel` cancela na hora uma nota ainda na fila, ou envia o evento de cancelamento à Sefin para uma NFS-e emitida (ou ainda em emissão) e informa o resultado por webhook. |
| Importação de planilha | Envie um CSV ou Excel, revise os problemas e emita centenas de notas de uma vez, com contadores ao vivo. Pelo painel, pela API ou por MCP. |
| Várias empresas | Gerencie vários emissores, cada um com seu perfil fiscal e certificado A1, num único workspace. |
| Documentos e entrega | Guarda PDF e XML, links de download assinados, envio por e-mail e webhooks assinados a cada mudança de status. |
| Agentes de IA | Um servidor MCP remoto permite que agentes emitam e consultem notas, e o `llms.txt` permite que um agente de código escreva a integração para você. |
| Painel | Empresas, notas, chaves de API, membros, cobrança e agentes conectados, em português ou inglês. |
| Ambientes fiscais | Teste e produção ficam separados. O teste não exige certificado e não tem valor fiscal. |
| Planos e créditos | Um ambiente de teste gratuito, planos pagos com franquia mensal e créditos avulsos por nota. Preços públicos em `GET /v1/plans`. |

> [!NOTE]
> O Corvo cobre apenas **NFS-e (serviços)**, não NF-e nem NFC-e. Veja as [limitações fiscais](docs/fiscal/limitations.md) para o que ainda não é coberto.

## Como funciona

```text
Seu app / ERP / agente de IA
        │  REST (X-API-Key)  ou  MCP (OAuth)
        ▼
   API do Corvo  ──►  fila + worker  ──►  motor fiscal  ──►  NFS-e nacional (Sefin)
        │                                   │
        │                                   └─ calculadora de tributos (RTC, IBS/CBS)
        ▼
 PostgreSQL · Redis · S3          webhooks / e-mail  ──►  seu sistema e seu cliente
```

A API recebe o pedido e responde `202`. O worker classifica o serviço, calcula os tributos, monta e assina a DPS, envia ao sistema nacional, guarda o resultado e avisa você.

Para ver o funcionamento por dentro, com diagramas (outbox, ledger de créditos, o que é gravado de forma atômica, status da nota e filas), leia [docs/architecture.md](docs/architecture.md).

## Início rápido

Você precisa de **Docker com Compose v2** e **Node.js 24**. O Docker instala as dependências da aplicação; neste caminho você não precisa do Yarn.

### 1. Clone e gere a configuração

```bash
git clone https://github.com/corvo-technology/corvo-nfse.git
cd corvo-nfse
node scripts/setup-env.mjs
```

O setup gera senhas e chaves de criptografia e cria os arquivos de ambiente que faltam. Rodar de novo preserva os arquivos e as chaves que você já tem.

### 2. Suba o ambiente local

```bash
docker compose --env-file deploy/.env.local \
  -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml \
  up -d --build --wait --wait-timeout 180
```

Com o Yarn instalado, `yarn local:up` faz o mesmo. Isso sobe o painel, a API, o worker, o PostgreSQL, o Redis, o LocalStack e a calculadora de tributos. A imagem da calculadora é construída a partir do zip oficial, cujo endereço e checksum o setup já gravou no arquivo de ambiente (`RTC_ZIP_URL`, `RTC_ZIP_SHA256`); o build para de propósito se o arquivo publicado deixar de bater com o checksum (veja [deploy/README.md](deploy/README.md)). As migrações do banco rodam antes de as aplicações iniciarem.

| Abra | Endereço |
| --- | --- |
| Painel | [localhost:4000](http://localhost:4000) |
| API | `http://localhost:3000/v1` |
| Servidor MCP | `http://localhost:3000/mcp` |
| Documentação | [localhost:4000/pt/docs](http://localhost:4000/pt/docs) |

### 3. Configure as integrações que quiser testar

O `deploy/.env.local` gerado tem tudo o que é preciso para começar. Para entrar com um código por e-mail, adicione o seu provedor de e-mail:

```dotenv
# deploy/.env.local
RESEND_API_KEY=sua_chave_de_api_do_provedor_de_email
RESEND_BASE_URL=https://api.millionsend.com
EMAIL_FROM=Corvo <noreply@seudominio.com>
```

Use um remetente autorizado pelo seu provedor. Os valores locais do Stripe só permitem que a aplicação inicie; troque por credenciais de teste do Stripe para experimentar a cobrança. Depois de editar o arquivo de ambiente, rode o mesmo comando do Compose de novo. Com o Yarn, `yarn local:logs` acompanha os logs e `yarn local:down` para o ambiente.

## Usar a API

Crie uma chave de API no painel (**Chaves de API**; chaves que começam com `corvo_test_` usam o ambiente de teste), depois cadastre uma empresa e emita uma nota:

```bash
export BASE_URL=http://localhost:3000/v1
export CORVO_API_KEY=corvo_test_sua_chave

curl -X POST "$BASE_URL/companies" \
  -H "X-API-Key: $CORVO_API_KEY" -H "Content-Type: application/json" \
  -d '{"legalName":"Empresa Exemplo Ltda","taxId":"11222333000181","taxRegime":"MEI","municipalityCode":"3550308","defaultServiceCode":"060101"}'

curl -X POST "$BASE_URL/invoices" \
  -H "X-API-Key: $CORVO_API_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: pedido_123" \
  -d '{"companyTaxId":"11222333000181","service":{"description":"Corte de cabelo"},"amount":50,"competenceDate":"2026-10-16"}'
```

A segunda chamada devolve `202` com a nota no estado `queued`. Acompanhe com `GET /v1/invoices/:id` ou por webhook. Todos os endpoints, campos e erros estão na [referência da API](http://localhost:4000/pt/docs).

## Agentes de IA (MCP)

Os agentes se conectam a um único endereço e aprovam o acesso no navegador:

```bash
claude mcp add --transport http corvo http://localhost:3000/mcp
```

A pessoa entra, escolhe o workspace e escolhe **teste** ou **produção** na tela de aprovação. A página **Agentes de IA** do painel lista os aplicativos conectados, o uso deles e permite revogar o acesso. Para que um agente de código escreva a integração no seu projeto, entregue a ele o `/llms-full.txt`. Veja [Agentes de IA (MCP)](http://localhost:4000/pt/docs/mcp) e [Construa com IA](http://localhost:4000/pt/docs/llms).

## Deploy em produção

A produção usa o `deploy/.env` e o arquivo principal do Compose. Roda com `NODE_ENV=production` e guarda os documentos num **bucket S3 externo**. O LocalStack pertence só ao ambiente local.

Depois de rodar o setup, edite o `deploy/.env` com base no [deploy/.env.example](deploy/.env.example):

| Configure | Variáveis |
| --- | --- |
| URLs públicas em HTTPS | `APP_ORIGIN`, `PUBLIC_API_URL` |
| Armazenamento S3 | `STORAGE_S3_BUCKET`, `STORAGE_S3_ENDPOINT`, `STORAGE_S3_REGION`, `STORAGE_S3_ACCESS_KEY_ID`, `STORAGE_S3_SECRET_ACCESS_KEY` |
| Envio de e-mail e códigos de login | `RESEND_API_KEY`, `RESEND_BASE_URL`, `EMAIL_FROM` |
| Cobrança com Stripe | `STRIPE_SECRET_KEY`, `STRIPE_PLATFORM_WEBHOOK_SECRET` |
| Calculadora de tributos | Preenchido pelo setup (`RTC_ZIP_URL`, `RTC_ZIP_SHA256`); use uma `RTC_IMAGE` pronta para deploys reproduzíveis |

> [!WARNING]
> O setup gera as senhas e os segredos internos. Guarde-os junto com os seus backups: os certificados criptografados dependem deles.

Use origens públicas sem caminho e sem barra no final, como `https://corvo.exemplo.com` e `https://api.corvo.exemplo.com`.

```bash
yarn deploy:up   # valida a configuração, depois constrói e sobe o ambiente
```

Configure o HTTPS na sua plataforma de hospedagem, ou ative o proxy Caddy opcional numa VPS. Veja o [guia de self-hosting](SELF_HOSTING.md) para as duas opções, atualizações e solução de problemas.

## Desenvolver

Use Node.js 24 e Yarn 1.22.22:

```bash
yarn setup
```

| Comando | Ação |
| --- | --- |
| `yarn dev` | Roda web, API e worker com recarga automática. |
| `yarn local:up` / `local:logs` / `local:down` | Constrói, acompanha e para o ambiente Docker local. |
| `yarn deploy:up` / `deploy:logs` / `deploy:down` | Valida, sobe, acompanha e para o ambiente de produção. |
| `yarn infra:up` / `infra:down` | Sobe ou para só o PostgreSQL, o Redis e o LocalStack para desenvolver fora do Docker. |
| `yarn migration:run` / `migration:show` | Roda ou lista as migrações do banco. |
| `yarn build` | Constrói o backend e o frontend. |
| `yarn lint` | Verifica as duas aplicações com o ESLint. |
| `yarn typecheck` | Verifica o código TypeScript de produção. |
| `yarn test` | Roda os testes unitários do backend e do frontend. |
| `yarn test:e2e:api` / `test:e2e:web` | Roda as suítes ponta a ponta (precisam de preparo próprio). |
| `yarn check` | Lint, typecheck, testes e build. |

Para desenvolver fora do Docker, prepare o banco e os arquivos de ambiente de cada aplicação e rode `yarn dev`. Siga o [CONTRIBUTING.md](CONTRIBUTING.md), o [api/README.md](api/README.md) e o [web/README.md](web/README.md).

## Estrutura do repositório

```text
api/       API NestJS e worker em segundo plano
web/       Painel Next.js, site e referência da API
deploy/    Dockerfiles, Compose de produção e override local
scripts/   Setup de configuração e comandos de desenvolvimento
docs/      Regras fiscais, limitações, runbooks e notas de design
```

A API e o worker compartilham código de backend e rodam como processos separados em produção. Cada aplicação mantém as suas dependências e o seu lockfile; os comandos da raiz as coordenam.

## Documentação

| Onde | O quê |
| --- | --- |
| Referência da API em `/pt/docs` e `/en/docs` (no ambiente local: [localhost:4000/pt/docs](http://localhost:4000/pt/docs)) | Endpoints, erros, webhooks, cobrança e agentes de IA. |
| [llms.txt](web/public/llms.txt) e `/llms-full.txt` | A mesma documentação para ferramentas de IA. |
| [SELF_HOSTING.md](SELF_HOSTING.md) | Rodar o Corvo na sua própria infraestrutura. |
| [deploy/README.md](deploy/README.md) | Arquivos Docker e a calculadora de tributos. |
| [docs/architecture.md](docs/architecture.md) | Como funciona por dentro: outbox, ledger de créditos, transações, status e filas, com diagramas. |
| [docs/fiscal](docs/fiscal) | Regras fiscais, exemplos, limitações, observabilidade e runbooks. |

## Aviso legal

O Corvo emite documentos fiscais. Quem o executa é responsável pelos dados da empresa, pelo certificado A1 e pelo que é emitido. É software, não consultoria tributária: confira as [limitações fiscais](docs/fiscal/limitations.md) antes de emitir em produção. Se você trata dados pessoais, a LGPD se aplica a você como operador.

## Comunidade e licença

O Corvo NFS-e é licenciado sob a [GNU Affero General Public License, versão 3](LICENSE) (`AGPL-3.0-only`). A participação segue o nosso [Código de Conduta](CODE_OF_CONDUCT.md); siga o [CONTRIBUTING.md](CONTRIBUTING.md) para contribuir. Para relatos privados de vulnerabilidade, veja o [SECURITY.md](SECURITY.md).
