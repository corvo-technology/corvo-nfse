// lib/docs/content/pt.ts
import { SDKS } from "../../sdks";
import type { DocsTree } from "../types";
import { importsPage } from "../imports-page";
import { municipalitiesPage } from "../municipalities-page";

const ptWithRetiredCredits: DocsTree = {
  chrome: {
    homeLabel: "Introdução",
    groups: { gettingStarted: "Começando", reference: "Referência", guides: "Guias" },
    copy: {
      copy: "Copiar",
      copied: "Copiado",
      response: "Resposta",
      close: "Fechar",
      menu: "Menu",
      table: { field: "Campo", type: "Tipo", required: "Obrigatório", description: "Descrição" },
    },
    localeSwitch: { en: "English", pt: "Português" },
    notFound: { title: "Página não encontrada", body: "Confira a URL." },
  },
  home: {
    title: "Introdução",
    description: "Emita NFS-e de empresas MEI e do Simples Nacional por uma API REST ou por um agente de IA (MCP): cálculo de tributos, várias empresas e webhooks.",
    blocks: [
      {
        kind: "text",
        body: "A API da Corvo permite cadastrar empresas (MEI e Simples Nacional), enviar certificados A1, calcular tributos antes de emitir, emitir notas fiscais de serviço (NFS-e) e acompanhar o ciclo de vida completo por webhooks. Agentes de IA como Claude Code, Cursor e Codex fazem o mesmo pelo servidor MCP (veja Agentes de IA).",
      },
      { kind: "heading", level: 2, body: "Quickstart" },
      { kind: "text", body: "Do cadastro à primeira nota, no ambiente de teste. Em teste não é preciso certificado; em produção são necessários uma chave `corvo_live_` e um certificado A1." },
      { kind: "list", items: ["Crie a conta grátis em https://www.corvo.tech/login?mode=signup (sem cartão de crédito).", "No painel, gere uma chave de teste. Ela começa com `corvo_test_`; notas emitidas com ela não têm valor fiscal.", "Cadastre a empresa emissora com `POST /v1/companies` (`legalName`, `taxId`, `taxRegime` e `municipalityCode` são obrigatórios).", "Emita a nota com `POST /v1/invoices`. A resposta é `202` com status `queued`: a emissão é assíncrona.", "Acompanhe com `GET /v1/invoices/:id` ou receba o webhook `nfse.invoice.authorized` / `nfse.invoice.rejected`.", "Vá para produção: crie uma chave `corvo_live_` e envie o certificado A1 da empresa pelo painel ou pela API (`POST /v1/companies/:companyId/certificates`)."] },
      { kind: "code", label: "bash", language: "bash", code: "export BASE_URL='https://api.corvo.tech/v1'\nexport CORVO_API_KEY='corvo_test_sua_chave'\n\n# 3. Cadastrar a empresa\ncurl -X POST \"$BASE_URL/companies\" \\\n  -H \"X-API-Key: $CORVO_API_KEY\" \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"legalName\":\"Empresa Exemplo Ltda\",\"taxId\":\"11222333000181\",\"taxRegime\":\"MEI\",\"municipalityCode\":\"3550308\"}'\n\n# 4. Emitir a nota (202, status queued)\ncurl -X POST \"$BASE_URL/invoices\" \\\n  -H \"X-API-Key: $CORVO_API_KEY\" \\\n  -H 'Content-Type: application/json' \\\n  -H 'Idempotency-Key: pedido_123_emissao' \\\n  -d '{\"companyTaxId\":\"11222333000181\",\"amount\":100,\"service\":{\"description\":\"Consultoria\"}}'\n\n# 5. Acompanhar\ncurl \"$BASE_URL/invoices/<id>\" -H \"X-API-Key: $CORVO_API_KEY" },
      {
        kind: "text",
        body: "Todos os caminhos desta documentação são relativos a `BASE_URL` (`https://api.corvo.tech/v1`).",
      },
      { kind: "heading", level: 2, body: "Formatos de resposta" },
      {
        kind: "text",
        body: "Sucessos REST usam `{ \"data\": ... }` e listagens acrescentam `pagination`. Datas JSON são strings ISO 8601; campos opcionais podem estar ausentes e campos anuláveis podem ser `null`.",
      },
      {
        kind: "table",
        head: ["Operação", "Formato JSON"],
        rows: [
          ["Criar, consultar ou atualizar empresa", "`{ \"data\": Company }`"],
          ["Listar empresas", "`{ \"data\": Company[], \"pagination\": {...} }`"],
          ["Excluir empresa", "`{ \"data\": null }`"],
          ["Upload / listagem de certificados", "`{ \"data\": Certificate } / listagem paginada`"],
          ["Emitir / consultar nota", "`{ \"data\": Invoice }`"],
          ["Listar notas e eventos", "`{ \"data\": [ ... ], \"pagination\": {...} }`"],
          ["URL de download / email", "`{ \"data\": ... }`"],
          ["Webhooks e entregas", "`{ \"data\": ... } ou listagem paginada`"],
          ["Plano e cotas", "`{ \"data\": ... }`"],
        ],
      },
      {
        kind: "text",
        body: "Os recursos vêm direto em `data`: uma nota é `data`, uma lista é `data[]`. Leia `data` uma única vez. PDF/XML, redirects, OAuth, MCP/JSON-RPC, health checks e respostas `204` mantêm seus formatos próprios.",
      },
      { kind: "heading", level: 2, body: "Todas as operações" },
      {
        kind: "text",
        body: "Todos os caminhos abaixo incluem o prefixo padrão. Os status representam o sucesso conforme a matriz de contratos HTTP; erros seguem o formato `ERROR_*` descrito em Erros.",
      },
      {
        kind: "table",
        head: ["Método", "Caminho", "Função", "Sucesso"],
        rows: [
          ["POST", "`/v1/companies`", "Cadastrar empresa", "201"],
          ["GET", "`/v1/companies`", "Listar empresas", "200"],
          ["GET", "`/v1/companies/:id`", "Consultar empresa", "200"],
          ["PATCH", "`/v1/companies/:id`", "Atualizar empresa", "200"],
          ["DELETE", "`/v1/companies/:id`", "Excluir empresa", "200"],
          ["POST", "`/v1/companies/:companyId/certificates`", "Enviar certificado", "201"],
          ["GET", "`/v1/companies/:companyId/certificates`", "Listar certificados", "200"],
          ["DELETE", "`/v1/companies/:companyId/certificates/:certId`", "Revogar certificado", "204"],
          ["POST", "`/v1/invoices`", "Solicitar emissão", "202"],
          ["POST", "`/v1/invoices/batches`", "Solicitar a emissão de até 50 notas", "202"],
          ["POST", "`/v1/invoices/calculate`", "Calcular tributos sem emitir", "200"],
          ["GET", "`/v1/invoices`", "Listar notas", "200"],
          ["GET", "`/v1/invoices/:id`", "Consultar nota", "200"],
          ["GET", "`/v1/invoices/:id/xml`", "Baixar XML", "200"],
          ["GET", "`/v1/invoices/:id/pdf`", "Baixar PDF", "200"],
          ["GET", "`/v1/invoices/:id/events`", "Consultar histórico", "200"],
          ["POST", "`/v1/invoices/:id/download-url`", "Gerar URL assinada", "200"],
          ["POST", "`/v1/invoices/:id/email`", "Solicitar envio de email", "202"],
          ["POST", "`/v1/invoices/:id/cancel`", "Cancelar nota", "200/202"],
          ["GET", "`/v1/webhooks`", "Listar configurações", "200"],
          ["POST", "`/v1/webhooks`", "Cadastrar webhook", "201"],
          ["DELETE", "`/v1/webhooks/:id`", "Excluir webhook", "200"],
          ["POST", "`/v1/webhooks/:id/test`", "Enviar evento de teste", "200"],
          ["GET", "`/v1/webhooks/deliveries`", "Listar entregas", "200"],
          ["GET", "`/v1/webhooks/deliveries/stats`", "Consultar estatísticas", "200"],
          ["POST", "`/v1/webhooks/deliveries/:id/retry`", "Agendar nova tentativa", "200"],
          ["GET", "`/v1/customers`", "Listar clientes salvos", "200"],
          ["GET", "`/v1/customers/:taxId`", "Consultar cliente salvo", "200"],
          ["PATCH", "`/v1/customers/:taxId`", "Corrigir cliente salvo", "200"],
          ["DELETE", "`/v1/customers/:taxId`", "Apagar cliente salvo", "200"],
          ["GET", "`/v1/schedules`", "Listar agendas e recorrências", "200"],
          ["GET", "`/v1/schedules/:id`", "Consultar uma agenda", "200"],
          ["GET", "`/v1/schedules/:id/runs`", "Histórico de execuções de uma agenda", "200"],
          ["PATCH", "`/v1/schedules/:id`", "Alterar uma agenda", "200"],
          ["POST", "`/v1/schedules/:id/pause`", "Pausar uma agenda", "200"],
          ["POST", "`/v1/schedules/:id/resume`", "Retomar uma agenda", "200"],
          ["POST", "`/v1/schedules/:id/cancel`", "Cancelar uma agenda", "200"],
          ["GET", "`/v1/billing/plan`", "Consultar plano e consumo", "200"],
          ["GET", "`/v1/billing/usage`", "Consultar disponibilidade e cotas", "200"],
          ["POST", "`/v1/billing/upgrade`", "Agendar troca de plano", "200"],
          ["POST", "`/v1/billing/downgrade`", "Agendar mudança de plano", "200"],
          ["GET", "`/v1/plans`", "Listar preços dos planos (público)", "200"],
          ["GET", "`/v1/plans/:slug`", "Consultar o preço de um plano (público)", "200"],
          ["GET", "`/v1/plans/recommend`", "Recomendar a forma mais barata de cobrir N notas por mês (público)", "200"],
        ],
      },
      {
        kind: "text",
        body: "IDs nos caminhos representam identificadores dos recursos retornados pela API. Guarde-os como strings; não use CNPJ no lugar de um `:id`.",
      },
      { kind: "heading", level: 2, body: "Sequência de integração" },
      {
        kind: "list",
        items: [
          "Obtenha uma chave `test` com escopo adequado — cadastro de empresa/certificado exige `full_access`; uma chave `invoices_read_write` pode emitir com cadastro prévio.",
          "`POST /v1/companies` — cadastre a empresa com CNPJ, regime e município fiscal (`municipalityCode`); configure `defaultServiceCode` para simplificar as notas.",
          "Em `live`, envie o certificado válido correspondente ao CNPJ (`POST /v1/companies/:companyId/certificates`). A inscrição municipal é opcional: informe só se o município a registrou no cadastro nacional.",
          "`POST /v1/invoices` — use `companyTaxId` (CNPJ da empresa) e solicite a emissão com `Idempotency-Key` estável por operação de negócio e guarde `data.id` (ambiente `live` exige prontidão da empresa).",
          "Acompanhe o ciclo por `GET /v1/invoices/:id` e webhooks assinados — a emissão é assíncrona.",
          "Aguarde os documentos ficarem prontos para gerar a URL e solicitar o email; confira o estado do email separadamente.",
        ],
      },
    ],
  },
  pages: {
    sdks: {
      title: "SDKs",
      description: "Bibliotecas oficiais para Node.js, Python, Go, PHP, Ruby, Rust, Java, Elixir e .NET.",
      blocks: [
        { kind: "text", body: "A Corvo tem SDKs oficiais em nove linguagens. Eles chamam a mesma API descrita nesta documentação, com as mesmas operações, nomes de campo e regras fiscais, então todos os guias daqui valem para todos eles." },
        { kind: "heading", level: 2, body: "Instalação" },
        {
          kind: "table",
          head: ["Linguagem", "Pacote", "Instalação", "Código"],
          rows: SDKS.map((sdk) => [sdk.name, `\`${sdk.pkg}\` (${sdk.registry})`, `\`${sdk.install}\``, `\`corvo-technology/${sdk.repo}\``]),
        },
        { kind: "callout", tone: "accent", body: "Comece com uma chave de teste: notas emitidas com uma chave `corvo_test_` não têm valor fiscal." },
        { kind: "heading", level: 2, body: "O que todo SDK faz" },
        {
          kind: "list",
          items: [
          "Autentica com `X-API-Key`. Lê `CORVO_API_KEY`, e `CORVO_BASE_URL` se você usar outra URL da API.",
          "A chave decide o ambiente: `corvo_test_...` para teste e `corvo_live_...` para produção.",
          "Os erros voltam como um resultado tipado com `code`, `status`, `requestId`, `details` e `retryAfter`, não como exceção. Os helpers de iteração lançam erro quando uma página falha.",
          "As listas usam paginação por cursor, e todo SDK tem um helper de iteração que percorre todas as páginas.",
          "Emitir uma nota e enviar um email aceitam chave de idempotência, enviada como `Idempotency-Key`.",
          "Verificação da assinatura do webhook (`X-Corvo-Signature`) em tempo constante.",
          ],
        },
        { kind: "heading", level: 2, body: "Emitir uma nota" },
        { kind: "text", body: "A mesma chamada em cada linguagem. Cada exemplo lê a chave de `CORVO_API_KEY` e passa uma chave de idempotência, então repetir a chamada nunca emite a nota duas vezes." },
        ...SDKS.map((sdk) => ({ kind: "code" as const, label: sdk.name, language: (sdk.id === "node" ? "js" : "text") as "js" | "text", code: sdk.snippet })),
        { kind: "text", body: "A troca de plano e o portal de cobrança existem só no painel, por isso não estão nos SDKs. O código de cada SDK está em github.com/corvo-technology." },
      ],
    },
    authentication: {
      title: "Autenticação",
      description: "Todas as rotas desta API exigem uma chave de API no header `X-API-Key`.",
      blocks: [
        {
          kind: "text",
          body: "Formato das chaves: `corvo_test_` ou `corvo_live_` seguido de 40 caracteres hexadecimais minúsculos.",
        },
        {
          kind: "callout",
          tone: "warn",
          body: "A chave completa é exibida somente na criação.",
        },
        { kind: "heading", level: 2, body: "Headers" },
        {
          kind: "table",
          head: ["Header", "Uso"],
          rows: [
            ["`X-API-Key`", "Obrigatório para autenticação por chave."],
            ["`Content-Type: application/json`", "Corpos JSON."],
            [
              "`Idempotency-Key`",
              "Opcional na emissão e na solicitação de email; recomendado para repetição segura dessas operações.",
            ],
          ],
        },
        {
          kind: "text",
          body: "Upload de certificado usa `multipart/form-data`. Com `curl -F`, deixe o curl gerar o `Content-Type` com boundary. Downloads retornam PDF ou XML, sem envelope JSON.",
        },
        { kind: "heading", level: 2, body: "Ambientes" },
        {
          kind: "list",
          items: [
            "Empresas, certificados e notas são acessados no ambiente persistido da chave: `test` ou `live`.",
            "Em `live`, a emissão verifica a empresa, bloqueio e certificado ativo; também se aplicam créditos e limites de emissão.",
            "Em `test`, a emissão exige empresa existente, mas dispensa as verificações de prontidão e certificado do fluxo `live`.",
            "Entregas de webhook usam o filtro explícito `?environment=test|live`; sem ele, podem retornar ambos os ambientes da conta, independentemente do ambiente da chave.",
          ],
        },
        {
          kind: "callout",
          tone: "warn",
          body: "Créditos, plano e configurações de webhook pertencem à conta. Uma chave `test` com `full_access` pode gerenciar webhooks e consultar créditos e cobrança. Troca de plano, checkout e portal de cobrança existem só no painel.",
        },
        { kind: "callout", tone: "accent", body: "O servidor resolve a conta pela autenticação; recursos de outra conta retornam `404`." },
        { kind: "heading", level: 2, body: "Escopos" },
        {
          kind: "table",
          head: ["Código", "Escopo", "O que permite"],
          rows: [
            ["F", "`full_access`", "Todas as operações listadas nesta documentação."],
            ["I", "`invoices_issue`", "Emitir notas e solicitar email."],
            ["V", "`invoices_view`", "Consultar notas, documentos, eventos e URL de download."],
            [
              "RW",
              "`invoices_read_write`",
              "Emissão e consulta de notas, consulta de empresas, listagem de certificados e consulta de webhooks/entregas/estatísticas.",
            ],
          ],
        },
        {
          kind: "text",
          body: "`invoices_read_write` não permite alterar empresas, certificados, webhooks, créditos ou planos. Mesmo `full_access` só acessa rotas habilitadas para API key; permissões do escopo não abrem outras rotas.",
        },
        { kind: "heading", level: 2, body: "Exemplo" },
        {
          kind: "code",
          label: "bash",
          language: "bash",
          code: "export BASE_URL='https://api.corvo.tech/v1'\nexport CORVO_API_KEY='SUA_CHAVE'\ncurl \"$BASE_URL/companies\" -H \"X-API-Key: $CORVO_API_KEY\"",
        },
      ],
    },
    errors: {
      title: "Erros",
      description: "Formato dos erros, códigos `ERROR_*` e códigos HTTP retornados pela API.",
      blocks: [
        {
          kind: "text",
          body: "Campos não declarados nos DTOs são rejeitados, inclusive em objetos aninhados. Toda falha REST usa o mesmo corpo; não existe mais um campo `error` separado.",
        },
        { kind: "heading", level: 2, body: "Formato do erro" },
        {
          kind: "code",
          label: "json",
          language: "json",
          code: `{
  "statusCode": 400,
  "code": "ERROR_VALIDATION",
  "message": "Request validation failed",
  "details": [
    {
      "field": "customer.taxId",
      "code": "ERROR_INVALID_TAX_ID",
      "message": "Invalid tax ID"
    }
  ],
  "requestId": "9f1fc995-4ee4-4a92-b285-cf8dff227a97"
}`,
        },
        {
          kind: "text",
          body: "Decida pelo `code` e pelo status HTTP. `message` é sempre uma string em inglês (nunca um array) e serve para diagnóstico. `details` é opcional: em validação é um array de `{ field, code, message }`; em erros de aplicação são objetos públicos tipados. `requestId` corresponde ao header `X-Request-Id` e pode ser informado ao suporte. Falhas `5xx` usam mensagens sanitizadas, sem detalhes internos.",
        },
        {
          kind: "callout",
          tone: "warn",
          body: "Erros em downloads de PDF/XML também seguem este contrato. Redirects, OAuth, MCP/JSON-RPC, health checks e respostas `204` mantêm seus formatos próprios.",
        },
        { kind: "heading", level: 2, body: "Códigos HTTP" },
        {
          kind: "table",
          head: ["HTTP", "Uso"],
          rows: [
            ["200 / 201 / 202", "Ação concluída / recurso criado / processamento assíncrono aceito."],
            ["204", "Operação concluída sem corpo."],
            ["400", "DTO, parâmetro, JSON, UUID, `limit` ou cursor inválido."],
            ["401 / 403", "Autenticação ausente ou inválida / acesso negado (escopo, endpoint não habilitado para API key, empresa bloqueada)."],
            ["404", "Recurso inexistente, inclusive de outro tenant."],
            ["409 / 410", "Conflito (CNPJ duplicado, idempotência conflitante, documentos ainda não prontos) / recurso encerrado."],
            ["413 / 415", "Payload excessivo / codificação não suportada."],
            ["422", "Validação fiscal no domínio ou regra de negócio rejeitada (prontidão, certificado, cota)."],
            ["429", "Rate limit ou cooldown; respeite `Retry-After`."],
            ["500 / 502 / 503 / 504", "Erro interno / dependência inválida / indisponibilidade / timeout."],
          ],
        },
        { kind: "heading", level: 2, body: "Códigos frequentes" },
        {
          kind: "table",
          head: ["code", "Quando ocorre"],
          rows: [
            ["`ERROR_VALIDATION`", "Corpo ou query inválidos; veja `details[]`."],
            ["`ERROR_INVALID_LIMIT`", "`limit` fora de 1–1000 ou não inteiro (400)."],
            ["`ERROR_INVALID_CURSOR`", "Cursor adulterado ou de outra coleção, tenant ou filtro (400)."],
            ["`ERROR_RATE_LIMIT_EXCEEDED`", "Limite de requisições excedido (429)."],
            ["`ERROR_INSUFFICIENT_CREDITS` / `ERROR_QUOTA_EXCEEDED`", "Créditos ou cota insuficientes para emitir."],
            ["`ERROR_COMPANY_NOT_READY` / `ERROR_COMPANY_BLOCKED`", "Empresa sem certificado em `live`, ou bloqueada."],
            ["`ERROR_IDEMPOTENCY_CONFLICT`", "Mesma `Idempotency-Key` com payload diferente (409)."],
            ["`ERROR_TAX_REGIME_NOT_SUPPORTED`", "Só empresas MEI e Simples Nacional são atendidas (422)."],
            ["`ERROR_VALIDATION` com `details[].code` `ERROR_DEDUCTION_NOT_ALLOWED_FOR_REGIME` ou `ERROR_SIMPLES_SUBLIMIT_NOT_SUPPORTED`", "Dedução da base do ISS que o MEI ou o Simples não pode declarar, ou Simples acima do sublimite (`regApTribSN` 2 ou 3), que ainda não é suportado (422)."],
            ["`ERROR_GONE`", "Operação encerrada, como a compra avulsa de créditos (410)."],
          ],
        },
        { kind: "heading", level: 2, body: "Boas práticas" },
        {
          kind: "list",
          items: [
            "Para respostas não 2xx, preserve status, `code` e `requestId` no diagnóstico, sem registrar a API key.",
            "Faça retry com backoff para `429`/`503`; em `429`, aguarde o `Retry-After`. Na emissão, preserve a chave de idempotência e o payload.",
            "Não repita erros de validação sem corrigir os dados indicados em `details`.",
          ],
        },
      ],
    },
    "rate-limits": {
      title: "Rate limits",
      description: "Limites de requisições por identidade e por IP, em janelas de 60 segundos.",
      blocks: [
        {
          kind: "table",
          head: ["Identidade", "Limite em janela de 60 segundos"],
          rows: [
            ["API key validada (somada entre endpoints)", "300"],
            ["Rotas públicas, por IP", "120"],
            ["Tenant inteiro (todas as chaves e sessões somadas)", "600"],
            ["Proteção anterior à autenticação, por IP", "1200"],
          ],
        },
        {
          kind: "text",
          body: "Rotas sensíveis têm orçamentos adicionais por rota, somados ao limite geral: OTP, magic link, OAuth e Turnstile (10 a 30 por minuto por IP), registro, token e revogação de clientes MCP (10 a 30 por minuto por IP) e as rotas autenticadas custosas `POST /invoices`, `POST /invoices/calculate` (120 por minuto por tenant), `POST /invoices/batches` (10 por minuto por tenant) e upload de certificado (10 por minuto por tenant). Health checks, preflight e o recebimento Stripe são isentos. Criar mais API keys não aumenta o teto: o limite do tenant vale para todas somadas.",
        },
        {
          kind: "text",
          body: "Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining` e `X-RateLimit-Reset` (Unix timestamp em segundos). Em `429`, o header `Retry-After` informa os segundos até uma nova tentativa e o corpo traz `code: \"ERROR_RATE_LIMIT_EXCEEDED\"`. Nas rotas sensíveis, os headers da proteção específica substituem os gerais.",
        },
        {
          kind: "callout",
          tone: "accent",
          body: "Respeite `Retry-After` antes de repetir a chamada e use backoff exponencial em picos. Não use `throughputRps` do plano como limite HTTP. Com o servidor saturado, a resposta é `503` com `code: \"ERROR_SERVER_BUSY\"` e `Retry-After: 1`: tente de novo com backoff.",
        },
      ],
    },
    companies: {
      title: "Empresas",
      description: "Cadastre e gerencie as empresas para emissão de NFS-e.",
      blocks: [
        { kind: "text", body: "Permissões: consultas usam `nfse.companies.view`; escrita usa `nfse.companies.manage`." },
        { kind: "heading", level: 2, body: "Do cadastro à emissão" },
        { kind: "list", items: [
          "`POST /v1/companies` com `taxRegime` e `municipalityCode`. `municipalReg` é opcional.",
          "`POST /v1/companies/:id/certificates` com o certificado A1.",
          "`POST /v1/invoices`.",
        ] },
        { kind: "callout", tone: "accent", body: "O regime informado no cadastro cria o perfil fiscal da empresa, vigente desde hoje e já aprovado por quem fez a chamada (usuário ou chave de API). Sem tomador ou com tomador CPF não há etapa de aprovação nem cadastro de serviço: a classificação vem do catálogo oficial pelo `service.code`. Com tomador CNPJ a retenção federal depende da política do serviço: cadastre o perfil do serviço com `withholdingPolicy` `NONE_CONFIRMED` ou `CONFIGURED` e aprove-o, senão o cálculo volta `blocked` com `TAX_APPLICABILITY_UNKNOWN`. `GET /v1/companies/:id` mostra `status` e `setupGaps` (`municipality_code`, `certificate`). Use `POST /v1/invoices/calculate` para conferir antes de emitir." },
        { kind: "callout", tone: "warn", body: "Mudar `taxRegime`, `simpleNational` ou `specialRegime` com `PATCH` no mesmo dia do cadastro retorna `409` (`ERROR_CONFLICT`, mensagem `profile_validity_conflict`), porque o perfil aprovado não é reescrito. Para uma mudança com data, use `PUT /v1/companies/:id/fiscal-profile` com `validFrom`. Perfis de serviço (`/v1/companies/:id/service-tax-profiles`) são opcionais e passam a ser exigidos quando o regime pede IBS/CBS ou ISS configurado: o cálculo retorna `FISCAL_CLASSIFICATION_REQUIRED` com os campos que faltam." },
        {
          kind: "endpoint",
          method: "POST",
          path: "/v1/companies",
          scopes: ["full_access"],
          success: "201 Created",
          summary: "Cadastra uma empresa.",
          params: {
            rows: [
              { name: "legalName", type: "string", required: true, description: "Razão social, até 200 caracteres, não vazia após trim." },
              { name: "taxId", type: "string", required: true, description: "CNPJ válido; normalizado antes de verificar duplicidade." },
              { name: "taxRegime", type: "string", required: true, description: "`MEI` ou `Simples Nacional`. A Corvo atende só esses dois regimes: qualquer outro valor devolve `422` `ERROR_TAX_REGIME_NOT_SUPPORTED`." },
              { name: "tradeName", type: "string", required: false, description: "Até 200 caracteres." },
              { name: "municipalReg", type: "string ou null", required: false, description: "Opcional, e não vazia quando enviada. Fica guardada, mas **não vai na nota** a menos que `sendMunicipalReg` seja `true`. `null` limpa o valor (e desliga `sendMunicipalReg`)." },
              { name: "sendMunicipalReg", type: "boolean", required: false, description: "Padrão `false`. Envia a inscrição municipal na DPS só se o município registrou esta empresa no cadastro nacional e a Receita exigir; senão a nota é rejeitada (E0120)." },
              { name: "municipalityCode", type: "string", required: true, description: "Código IBGE de exatamente 7 dígitos, obrigatório em teste e produção. Usado como município do emitente e padrão do local da prestação." },
              { name: "defaultServiceCode", type: "string", required: false, description: "Código nacional (cTribNac) de exatamente 6 dígitos; padrão das novas notas. Sem ele, informe `service.code` na emissão." },
              { name: "simpleNational", type: "boolean", required: false, description: "Se omitido, acompanha o regime (`true` para MEI e Simples Nacional)." },
              { name: "specialRegime", type: "string", required: false, description: "Um valor entre `\"0\"` e `\"6\"` (regEspTrib, RTC v1.01): 0 Nenhum, 1 Ato Cooperado, 2 Estimativa, 3 Microempresa Municipal, 4 Notário ou Registrador, 5 Profissional Autônomo, 6 Sociedade de Profissionais." },
              { name: "simplesRate", type: "string", required: false, description: "Obrigatório para `Simples Nacional`, ignorado para `MEI`. Alíquota efetiva total (%) do seu DAS, a que aparece no PGDAS-D, por exemplo `\"6.54\"` (0 a 100, no máximo 2 casas decimais). Vai em toda nota (`pTotTribSN`). A Corvo não calcula o DAS." },
              { name: "simplesIssRate", type: "string", required: false, description: "Opcional, só `Simples Nacional`. Alíquota efetiva de ISS (%) da sua faixa (1,80 a 5,00), necessária só quando algum cliente retém ISS. Ignorada para `MEI`." },
              { name: "address", type: "objeto", required: false, description: "`street` (200), `number` (20), `complement` (100), `district` (100), `city` (100), `state` (2) e `zip` (10), todos opcionais. UF válida, normalizada para maiúsculas. CEP com 8 dígitos, armazenado sem pontuação." },
            ],
          },
          examples: {
            curl: `curl -X POST "$BASE_URL/companies" \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "legalName": "Empresa Exemplo Ltda",
    "taxId": "11222333000181",
    "taxRegime": "Simples Nacional",
    "simplesRate": "6.54",
    "simpleNational": true,
    "municipalReg": "123456",
    "municipalityCode": "3550308",
    "defaultServiceCode": "010101",
    "address": {
      "street": "Rua Exemplo",
      "number": "100",
      "city": "São Paulo",
      "state": "SP",
      "zip": "01001000"
    }
  }'`,
            node: `const res = await fetch(\`\${BASE_URL}/companies\`, {
  method: "POST",
  headers: {
    "X-API-Key": process.env.CORVO_API_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    legalName: "Empresa Exemplo Ltda",
    taxId: "11222333000181",
    taxRegime: "Simples Nacional",
    simplesRate: "6.54",
    simpleNational: true,
    municipalReg: "123456",
    municipalityCode: "3550308",
    defaultServiceCode: "010101",
    address: {
      street: "Rua Exemplo",
      number: "100",
      city: "São Paulo",
      state: "SP",
      zip: "01001000",
    },
  }),
});
const body = await res.json();
console.log(body.data.id); // { data: Company }`,
          },
          response: {
            label: "201 Created",
            json: `{
  "data": {
    "id": "3f1c8a90-6b2e-4d5a-9c11-8e2f0a7b4d11",
    "legalName": "Empresa Exemplo Ltda",
    "taxId": "11222333000181",
    "taxRegime": "Simples Nacional",
    "municipalityCode": "3550308",
    "defaultServiceCode": "010101",
    "status": "pending_setup",
    "environment": "test",
    "createdAt": "2026-10-10T12:00:00.000Z"
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "warn", body: "CNPJ repetido na mesma conta/ambiente retorna `409`. Em `live`, o cadastro pode falhar por limite de empresas ou plano bloqueado (`422`)." },
            { kind: "callout", tone: "accent", body: "O corpo de entrada usa `address`, mas a resposta expõe campos planos: `addressStreet`, `addressNumber`, `addressCity`, `addressState`, `addressZip` etc. `status` é `pending_setup`, `ready` ou `blocked`; `setupGaps` lista pendências (`municipality_code`, `certificate`)." },
          ],
        },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/companies",
          scopes: ["full_access", "invoices_read_write"],
          success: "200 OK",
          summary: "Lista as empresas da conta, com paginação por cursor.",
          params: {
            title: "Query",
            rows: [
              { name: "limit", type: "integer", required: false, description: "Padrão `50`; aceita inteiros de 1 a 1000 (valor inválido retorna `400`)." },
              { name: "cursor", type: "string", required: false, description: "`nextCursor` da página anterior, mantendo os mesmos filtros." },
            ],
          },
          examples: {
            curl: `curl "$BASE_URL/companies?limit=50&cursor=2026-10-10T12%3A00%3A00.000Z%7C3f1c8a90" \\
  -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/companies?limit=50\`, {
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const body = await res.json();
console.log(body.data, body.pagination); // { data: Company[], pagination }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": [
    {
      "id": "3f1c8a90-6b2e-4d5a-9c11-8e2f0a7b4d11",
      "legalName": "Empresa Exemplo Ltda",
      "taxId": "11222333000181",
      "status": "ready",
      "environment": "test",
      "createdAt": "2026-10-10T12:00:00.000Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "hasMore": true,
    "nextCursor": "eyJ2IjoxLCJjcmVhdGVkQXQiOiIyMDI2LTEwLTA5VDEyOjAwOjAwLjAwMDAwMFoiLCJpZCI6IjNmMWM4YTkwIn0"
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "warn", body: "Ordenação `createdAt DESC`, depois `id DESC`. Continue com `pagination.nextCursor` até `hasMore: false`; não há `total`." },
          ],
        },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/companies/:id",
          scopes: ["full_access", "invoices_read_write"],
          success: "200 OK",
          summary: "Consulta uma empresa pelo id.",
          examples: {
            curl: `curl "$BASE_URL/companies/$COMPANY_ID" \\
  -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/companies/\${companyId}\`, {
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const body = await res.json();
console.log(body.data.status); // { data: Company }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": {
    "id": "3f1c8a90-6b2e-4d5a-9c11-8e2f0a7b4d11",
    "legalName": "Empresa Exemplo Ltda",
    "taxId": "11222333000181",
    "taxRegime": "Simples Nacional",
    "status": "ready",
    "setupGaps": [],
    "environment": "test"
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "warn", body: "Empresa inexistente, excluída ou de outro ambiente/conta retorna `404`. Um `id` que não seja um UUID válido retorna `400` (`ERROR_BAD_REQUEST`)." },
          ],
        },
        {
          kind: "endpoint",
          method: "PATCH",
          path: "/v1/companies/:id",
          scopes: ["full_access"],
          success: "200 OK",
          summary: "Atualiza uma empresa. Aceita os campos da criação, todos opcionais, **exceto o CNPJ**: ele não pode ser alterado (enviar o CNPJ atual é aceito e ignorado; outro valor retorna `422`). Para outro CNPJ, cadastre uma nova empresa. Envie `simplesRate` (e `simplesIssRate`, ou `null` para remover) para atualizar a alíquota do Simples, por exemplo todo mês.",
          examples: {
            curl: `curl -X PATCH "$BASE_URL/companies/$COMPANY_ID" \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "tradeName": "Novo nome", "municipalReg": "987654" }'`,
            node: `const res = await fetch(\`\${BASE_URL}/companies/\${companyId}\`, {
  method: "PATCH",
  headers: {
    "X-API-Key": process.env.CORVO_API_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ tradeName: "Novo nome", municipalReg: "987654" }),
});
const body = await res.json();
console.log(body.data.tradeName); // { data: Company }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": {
    "id": "3f1c8a90-6b2e-4d5a-9c11-8e2f0a7b4d11",
    "legalName": "Empresa Exemplo Ltda",
    "tradeName": "Novo nome",
    "municipalReg": "987654",
    "status": "ready"
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "warn", body: "`municipalReg: null` limpa a inscrição; `address: null` limpa o endereço. `defaultServiceCode` omitido mantém o padrão; `null` remove; valor vazio ou inválido é rejeitado. `municipalityCode` exige 7 dígitos quando informado e não pode ser apagado. `environment` não pode ser alterado." },
            { kind: "callout", tone: "warn", body: "Pode retornar `400` por validação, `404` ou `409` por CNPJ duplicado." },
          ],
        },
        {
          kind: "endpoint",
          method: "DELETE",
          path: "/v1/companies/:id",
          scopes: ["full_access"],
          success: "200 OK",
          summary: "Exclui uma empresa (exclusão lógica).",
          examples: {
            curl: `curl -X DELETE "$BASE_URL/companies/$COMPANY_ID" \\
  -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/companies/\${companyId}\`, {
  method: "DELETE",
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const body = await res.json();
console.log(body.data); // { data: null }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": null
}`,
          },
          notes: [
            { kind: "callout", tone: "warn", body: "Exclusão lógica, sem corpo na requisição. Retorna `404` se a empresa não for encontrada." },
          ],
        },
      ],
    },
    certificates: {
      title: "Certificados",
      description: "Envie e gerencie certificados A1 (PKCS#12) das empresas.",
      blocks: [
        { kind: "text", body: "Você pode enviar o certificado A1 pelo painel (página da empresa) ou pela API, com o endpoint abaixo." },
        { kind: "text", body: "Permissões: `nfse.certificates.view` para listar e `nfse.certificates.manage` para upload/revogação." },
        {
          kind: "endpoint",
          method: "POST",
          path: "/v1/companies/:companyId/certificates",
          scopes: ["full_access"],
          success: "201 Created",
          summary: "Envia o certificado A1 (.p12/.pfx) da empresa em `multipart/form-data`.",
          params: {
            rows: [
              { name: "file", type: "arquivo", required: true, description: "Certificado PKCS#12 (.p12/.pfx), máximo 50 × 1024 bytes." },
              { name: "password", type: "string", required: true, description: "Obrigatória e não vazia, até 100 caracteres." },
            ],
          },
          examples: {
            curl: `curl -X POST "$BASE_URL/companies/$COMPANY_ID/certificates" \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -F 'file=@certificado.pfx' \\
  -F 'password=SENHA_DO_CERTIFICADO'`,
            node: `// FormData com File — suportado em navegadores e Node 18+
const form = new FormData();
form.append("file", new File([certBytes], "certificado.pfx", { type: "application/pkcs12" }));
form.append("password", process.env.CERT_PASSWORD);
const res = await fetch(\`\${BASE_URL}/companies/\${companyId}/certificates\`, {
  method: "POST",
  // sem Content-Type: o navegador/Node define o boundary do multipart
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
  body: form,
});
const body = await res.json();
console.log(body.data.id); // { data: Certificate }`,
          },
          response: {
            label: "201 Created",
            json: `{
  "data": {
    "id": "9a4e2b1c-7f3d-4e6a-b8c0-1d2e3f4a5b6c",
    "companyId": "3f1c8a90-6b2e-4d5a-9c11-8e2f0a7b4d11",
    "serialNumber": "3F1C8A90",
    "issuer": "AC Exemplo",
    "subject": "CN=11222333000181",
    "fingerprint": "ab:cd:ef:12",
    "validFrom": "2026-01-01T00:00:00.000Z",
    "validUntil": "2027-01-01T00:00:00.000Z",
    "status": "active",
    "createdAt": "2026-10-10T12:00:00.000Z"
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "warn", body: "Falhas: `400` por arquivo/senha ausente, `413` acima de 50 × 1024 bytes e `422` por certificado vencido ou CNPJ incompatível. Falhas de parsing dependem do erro produzido pelo parser; não assuma um único código para todo arquivo inválido." },
            { kind: "callout", tone: "accent", body: "O certificado é analisado, sua validade é conferida e o CNPJ deve corresponder ao da empresa. A resposta contém apenas metadados — nunca a senha ou o conteúdo do certificado. Status possíveis: `active`, `expired`, `revoked`." },
          ],
        },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/companies/:companyId/certificates",
          scopes: ["full_access", "invoices_read_write"],
          success: "200 OK",
          summary: "Lista os certificados de uma empresa.",
          examples: {
            curl: `curl "$BASE_URL/companies/$COMPANY_ID/certificates" \\
  -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/companies/\${companyId}/certificates\`, {
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const body = await res.json();
console.log(body.data, body.pagination); // { data: Certificate[], pagination }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": [
    {
      "id": "9a4e2b1c-7f3d-4e6a-b8c0-1d2e3f4a5b6c",
      "companyId": "3f1c8a90-6b2e-4d5a-9c11-8e2f0a7b4d11",
      "status": "active",
      "validUntil": "2027-01-01T00:00:00.000Z",
      "createdAt": "2026-10-10T12:00:00.000Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "hasMore": false,
    "nextCursor": null
  }
}`,
          },
        },
        {
          kind: "endpoint",
          method: "DELETE",
          path: "/v1/companies/:companyId/certificates/:certId",
          scopes: ["full_access"],
          success: "204 No Content",
          summary: "Revoga um certificado e atualiza a prontidão da empresa.",
          examples: {
            curl: `curl -X DELETE "$BASE_URL/companies/$COMPANY_ID/certificates/$CERT_ID" \\
  -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(
  \`\${BASE_URL}/companies/\${companyId}/certificates/\${certId}\`,
  { method: "DELETE", headers: { "X-API-Key": process.env.CORVO_API_KEY } },
);
console.log(res.status); // 204`,
          },
          response: { label: "204 No Content", json: "" },
          notes: [
            { kind: "callout", tone: "warn", body: "Sem corpo de resposta. Retorna `404` se o certificado/empresa não corresponderem à conta, ao ambiente ou ao caminho informado." },
          ],
        },
      ],
    },
    invoices: {
      title: "Notas fiscais",
      description: "Emita, consulte e acompanhe o ciclo de vida das NFS-e.",
      blocks: [
        { kind: "text", body: "Permissões: `nfse.invoices.issue` para emitir/solicitar email; `nfse.invoices.view` para consultas, documentos e URL assinada." },
        {
          kind: "endpoint",
          method: "POST",
          path: "/v1/invoices",
          scopes: ["full_access", "invoices_issue", "invoices_read_write"],
          success: "202 Accepted",
          summary: "Solicita a emissão de uma NFS-e. A emissão é assíncrona: o sucesso HTTP significa que a solicitação foi registrada/enfileirada, não autorização fiscal. Os exemplos usam o CNPJ (`companyTaxId`) da empresa cadastrada com `municipalityCode` e `defaultServiceCode`. O município do emitente sempre vem da empresa.",
          params: {
            rows: [
              { name: "companyId", type: "string UUID", required: false, description: "Condicional: informe este campo ou `companyTaxId`; se ambos existirem, `companyId` prevalece." },
              { name: "companyTaxId", type: "string", required: false, description: "CNPJ da empresa já cadastrada na conta/ambiente; pontuação opcional." },
              { name: "externalId", type: "string", required: false, description: "Referência do sistema integrador; não substitui a chave de idempotência." },
              { name: "customer", type: "objeto", required: false, description: "Opcional: omita ou envie `{}` para uma nota sem tomador (o tomador não vai na DPS). Quando enviado com qualquer dado, `taxId` é obrigatório (CPF ou CNPJ válido, normalizado); `name` é opcional, `email` (opcional; obrigatório quando o envio de email está habilitado; sem validação de formato neste DTO) e `address` (opcional: `street`, `city`, `state`, `zip`, `country`; se preencher cidade ou UF, preencha ambas)." },
              { name: "service", type: "objeto", required: true, description: "`code` é opcional: sem ele vale o `defaultServiceCode` da empresa e, se ela não tiver, `100901` (LC 116 item 10.09, representação de qualquer natureza); quando informado, exatamente 6 dígitos. `municipalityCode` herda o município da empresa; quando informado, exatamente 7 dígitos e define o local da prestação. `description` é opcional: se vazia, usa-se o nome do código de serviço. Vazio, `null` ou valor inválido dos demais campos não aciona o padrão." },
              { name: "amount", type: "number", required: true, description: "Valor em reais, positivo, até 9999999999.99 e no máximo 2 casas decimais." },
              { name: "competenceDate", type: "string ISO 8601", required: true, description: "Data de competência válida. Sem `options.type`, não pode ser futura (`422` `ERROR_FUTURE_DATE`). Com `SCHEDULE` ou `RECURRING`, é a data da primeira execução, de amanhã em diante (veja Notas agendadas e recorrentes)." },
              { name: "discount", type: "number", required: false, description: "Desconto incondicional em reais, de 0 até o valor da nota, no máximo 2 casas decimais." },
              { name: "deduction", type: "number", required: false, description: "Dedução da base do ISS declarada pelo emitente, em reais: maior que 0 e menor que `amount` menos `discount`, no máximo 2 casas decimais (`0` equivale a omitir). Vai na DPS em `vDedRed/vDR` e reduz a base de cálculo do ISS. A nota continua sendo emitida pelo valor total. O emitente responde pelo valor declarado; a Corvo não confere se a dedução é permitida. O IBS/CBS segue calculado sobre o valor sem a dedução. Veja Dedução da base do ISS." },
              { name: "purchaseOrder", type: "string", required: false, description: "Número do pedido, da ordem de compra ou da ordem de serviço que o cliente pediu para constar na nota, com até 60 caracteres em uma linha. Vai na DPS em `serv/infoCompl/xPed` e sai impresso no PDF. Não muda nenhum tributo." },
              { name: "notes", type: "string", required: false, description: "Texto livre impresso na nota como informação complementar, com até 2.000 caracteres (aceita quebra de linha). Vai na DPS em `serv/infoCompl/xInfComp`. Não muda nenhum tributo. Valor em branco equivale a omitir." },
              { name: "email", type: "boolean", required: false, description: "Solicita notificação; padrão `false`." },
              { name: "options.email.send", type: "boolean", required: false, description: "Quando definido, prevalece sobre `email`." },
              { name: "options.type", type: "string", required: false, description: "`IMMEDIATE` (padrão), `SCHEDULE` ou `RECURRING`. `SCHEDULE` e `RECURRING` criam uma agenda em vez de emitir agora; veja Notas agendadas e recorrentes." },
              { name: "options.recurrence.frequency", type: "string", required: false, description: "`WEEKLY`, `BIWEEKLY` ou `MONTHLY`. Obrigatório com `RECURRING`; proibido nos outros tipos." },
              { name: "options.recurrence.endsOn", type: "string YYYY-MM-DD", required: false, description: "Último dia em que a recorrência pode rodar (inclusive). Sem ele, roda até ser pausada ou cancelada." },
            ],
          },
          examples: {
            curl: `curl -X POST "$BASE_URL/invoices" \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -H 'Content-Type: application/json' \\
  -H 'Idempotency-Key: pedido_123_emissao' \\
  -d '{
    "companyTaxId": "11222333000181",
    "externalId": "pedido_123",
    "customer": {
      "name": "Cliente Exemplo",
      "taxId": "52998224725",
      "email": "cliente@example.com",
      "address": { "city": "São Paulo", "state": "SP" }
    },
    "service": {
      "description": "Prestação de serviço"
    },
    "amount": 150.50,
    "competenceDate": "2026-10-01",
    "options": { "email": { "send": true } }
  }'`,
            node: `const res = await fetch(\`\${BASE_URL}/invoices\`, {
  method: "POST",
  headers: {
    "X-API-Key": process.env.CORVO_API_KEY,
    "Content-Type": "application/json",
    "Idempotency-Key": "pedido_123_emissao",
  },
  body: JSON.stringify({
    companyTaxId: "11222333000181",
    externalId: "pedido_123",
    customer: {
      name: "Cliente Exemplo",
      taxId: "52998224725",
      email: "cliente@example.com",
      address: { city: "São Paulo", state: "SP" },
    },
    service: {
      description: "Prestação de serviço",
    },
    amount: 150.5,
    competenceDate: "2026-10-01",
    options: { email: { send: true } },
  }),
});
const body = await res.json();
console.log(body.data.id); // { data: Invoice }`,
          },
          response: {
            label: "202 Accepted",
            json: `{
  "data": {
    "id": "c7d2e9a1-4b5f-4a6c-8d9e-0f1a2b3c4d5e",
    "companyId": "3f1c8a90-6b2e-4d5a-9c11-8e2f0a7b4d11",
    "environment": "test",
    "externalId": "pedido_123",
    "status": "queued",
    "amount": 150.5,
    "competenceDate": "2026-10-01T00:00:00.000Z",
    "createdAt": "2026-10-10T12:00:00.000Z"
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "accent", body: "Idempotência: mesma chave, conta e ambiente com conteúdo equivalente ao hash recuperado devolve a mesma nota; conteúdo diferente retorna `409` (`ERROR_IDEMPOTENCY_CONFLICT`). O hash é calculado antes da normalização fiscal, com canonização das chaves JSON e da data de competência: não altere a representação dos campos ao repetir uma requisição (CNPJ com e sem pontuação pode gerar hashes diferentes). Sem chave não há deduplicação." },
            { kind: "callout", tone: "warn", body: "A emissão é assíncrona — veja a página Emissão assíncrona. Resposta normalmente vem com `status: \"queued\"`; acompanhe com GET ou webhooks." },
            { kind: "callout", tone: "warn", body: "O endereço do cliente é reduzido a `city` e `state` no snapshot: `street`, `zip` e `country` não são preservados na criação da nota. Não dependa deles no retorno." },
          ],
        },
        {
          kind: "endpoint",
          method: "POST",
          path: "/v1/invoices/batches",
          scopes: ["full_access", "invoices_issue", "invoices_read_write"],
          success: "202 Accepted",
          summary: "Solicita a emissão de **1 a 50 notas em uma única chamada**, de uma empresa ou de várias. Cada item tem os mesmos campos de `POST /v1/invoices` mais um `idempotencyKey` opcional. Os itens são conferidos um a um: os válidos são salvos juntos em uma única transação e os inválidos voltam como `rejected` com o motivo e **não** são salvos. A emissão continua assíncrona, como em `POST /v1/invoices`.",
          params: {
            rows: [
              { name: "invoices", type: "array", required: true, description: "Lista de 1 a 50 itens. Cada item recebe os campos de `POST /v1/invoices` (`companyId` ou `companyTaxId`, `service`, `amount`, `competenceDate`, `customer`, `discount`, `deduction`, `options` opcionais...). Os itens podem ser de empresas diferentes da conta. Menos de 1 ou mais de 50 itens devolve `400` `ERROR_VALIDATION` para a requisição inteira." },
              { name: "invoices[].idempotencyKey", type: "string", required: false, description: "Chave de idempotência do item (até 255 caracteres). Com a mesma chave e o mesmo conteúdo, repetir o lote devolve a nota já salva com `replayed: true` em vez de emitir de novo. O header `Idempotency-Key` não é usado nesta rota." },
            ],
          },
          examples: {
            curl: `curl -X POST "$BASE_URL/invoices/batches" \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -H 'Content-Type: application/json' \\
  -d '{
    "invoices": [
      {
        "companyTaxId": "11222333000181",
        "idempotencyKey": "planilha-out-linha-2",
        "customer": { "name": "Cliente A", "taxId": "52998224725" },
        "service": { "description": "Consultoria" },
        "amount": 150.50,
        "competenceDate": "2026-10-01"
      },
      {
        "companyTaxId": "45723174000110",
        "idempotencyKey": "planilha-out-linha-3",
        "service": { "description": "Manutenção mensal" },
        "amount": 300,
        "competenceDate": "2026-10-01"
      }
    ]
  }'`,
            node: `const res = await fetch(\`\${BASE_URL}/invoices/batches\`, {
  method: "POST",
  headers: {
    "X-API-Key": process.env.CORVO_API_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    invoices: rows.map((row, i) => ({
      companyTaxId: row.cnpj,
      idempotencyKey: \`planilha-out-linha-\${i + 2}\`,
      service: { description: row.description },
      amount: row.amount,
      competenceDate: "2026-10-01",
    })),
  }),
});
const { data } = await res.json();
for (const item of data.results) {
  if (item.status === "rejected") console.log(item.index, item.error.code, item.error.message);
}`,
          },
          response: {
            label: "202 Accepted",
            json: `{
  "data": {
    "total": 3,
    "accepted": 2,
    "rejected": 1,
    "results": [
      {
        "index": 0,
        "status": "accepted",
        "invoice": {
          "id": "6c4d2e81-0a3b-4c5d-9e7f-1a2b3c4d5e6f",
          "companyId": "3f1c8a90-6b2e-4d5a-9c11-8e2f0a7b4d11",
          "environment": "test",
          "idempotencyKey": "planilha-out-linha-2",
          "status": "queued",
          "amount": 150.5,
          "currency": "BRL",
          "competenceDate": "2026-10-01T00:00:00.000Z",
          "stage": "pending",
          "createdAt": "2026-10-10T12:00:00.000Z"
        }
      },
      {
        "index": 1,
        "status": "accepted",
        "replayed": true,
        "invoice": {
          "id": "0b7a1f52-3c4d-4e6f-8a9b-2c3d4e5f6a7b",
          "status": "queued",
          "idempotencyKey": "planilha-out-linha-3",
          "amount": 300
        }
      },
      {
        "index": 2,
        "status": "rejected",
        "error": {
          "code": "ERROR_VALIDATION",
          "message": "Request validation failed",
          "details": [
            { "field": "amount", "code": "ERROR_OUT_OF_RANGE", "message": "amount must be greater than 0" }
          ]
        }
      }
    ]
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "accent", body: "**Tudo ou nada para as válidas, nunca para o lote.** Todo item `accepted` é salvo em um único commit, junto com a reserva de crédito e a mensagem de fila. Um item inválido (validação, empresa não encontrada ou não pronta, certificado ausente em `live`, limite do plano) volta `rejected` e é descartado sem afetar os outros. Se algo inesperado falhar ao salvar, nada é salvo e você pode repetir o mesmo lote com segurança." },
            { kind: "callout", tone: "accent", body: "**Lendo o resultado.** `results` traz uma entrada por item, na ordem enviada: use `index` para ligar cada resultado à linha da planilha ou ao seu registro. Corrija só as linhas `rejected` e envie de novo; as `accepted` já estão salvas. Envie sempre um `idempotencyKey` por item (por exemplo `arquivo-linha-7`): depois de um timeout, repetir o lote inteiro devolve as já salvas como `replayed: true` e tenta só as que faltam. Uma chave repetida dentro do mesmo lote é rejeitada com `ERROR_DUPLICATE_IDEMPOTENCY_KEY_IN_BATCH`." },
            { kind: "callout", tone: "warn", body: "Em `live`, cada item aceito reserva um crédito, como em `POST /v1/invoices`. Quando o limite mensal ou diário é atingido no meio do lote, os itens que couberem são salvos e os demais voltam `rejected` com `ERROR_MONTHLY_LIMIT_EXCEEDED`, `ERROR_DAILY_LIMIT_EXCEEDED` ou `ERROR_PLAN_BLOCKED`. A rota aceita até 10 lotes por minuto por tenant (`429` com `Retry-After`). Para agentes de IA, a ferramenta MCP `nfse_issue_batch` tem o mesmo contrato." },
          ],
        },
        {
          kind: "endpoint",
          method: "POST",
          path: "/v1/invoices/calculate",
          scopes: ["full_access", "invoices_issue", "invoices_read_write"],
          success: "200 OK",
          summary: "Calcula os tributos de uma nota **sem emitir**: não grava nota, não consome crédito, não reserva número de DPS, não agenda nem chama a Sefin. Use para conferir a configuração fiscal e mostrar o valor ao cliente antes de `POST /v1/invoices`.",
          params: {
            rows: [
              { name: "(corpo)", type: "objeto", required: true, description: "Mesmo corpo de `POST /v1/invoices` (empresa, `service`, `amount`, `competenceDate`, `customer` opcional, `discount`, `deduction`). Exige a permissão `nfse.invoices.issue`. Não exige certificado nem empresa pronta." },
            ],
          },
          examples: {
            curl: `curl -X POST "$BASE_URL/invoices/calculate" \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "companyTaxId": "11222333000181",
    "service": { "code": "060101", "description": "Corte de cabelo" },
    "amount": 50,
    "competenceDate": "2026-10-13"
  }'`,
            node: `const res = await fetch(\`\${BASE_URL}/invoices/calculate\`, {
  method: "POST",
  headers: {
    "X-API-Key": process.env.CORVO_API_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    companyTaxId: "11222333000181",
    service: { code: "060101", description: "Corte de cabelo" },
    amount: 50,
    competenceDate: "2026-10-13",
  }),
});
const { data } = await res.json();
console.log(data.status, data.netReceivableAmount); // "ready" "50.00"`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": {
    "preEmission": true,
    "status": "ready",
    "disclaimer": "Pre-emission calculation. Values are not a fiscal document and may differ from the final validation by Sefin.",
    "competenceDate": "2026-10-13",
    "taxRegime": "MEI",
    "classification": {
      "serviceCode": "060101",
      "source": "official_catalog",
      "operationNature": "SERVICE",
      "nbsCode": null,
      "cst": null,
      "classCode": null,
      "serviceProfileId": null,
      "catalogValidated": false
    },
    "applicability": {
      "customerRequired": false,
      "strategy": "mei",
      "iss": {
        "status": "NOT_APPLICABLE",
        "reason": "ISS recolhido no DAS-MEI"
      },
      "federalWithholding": {
        "status": "NOT_APPLICABLE",
        "reason": "no federal withholding on payments to Simples Nacional/MEI optants (IN RFB 1.234/2012, art. 4, XI)"
      },
      "cbs": {
        "status": "NOT_APPLICABLE",
        "reason": "MEI não destaca IBS/CBS na fase de teste de 2026"
      },
      "ibs": {
        "status": "NOT_APPLICABLE",
        "reason": "MEI não destaca IBS/CBS na fase de teste de 2026"
      }
    },
    "taxes": {},
    "withholdings": [],
    "netReceivableAmount": "50.00",
    "collectionWaived": false,
    "calculation": {
      "source": "none",
      "calculatorVersion": null,
      "rulesVersion": "2026.10-r1",
      "legalReferences": [
        "Ato Conjunto RFB/CGIBS nº 4/2026; orientação CGNFS-e de 07/08/2026"
      ]
    },
    "warnings": [
      {
        "code": "CLASSIFICATION_NOT_CATALOG_VALIDATED",
        "message": "Service tax classification was not validated against the official catalog",
        "step": "ServiceTaxClassifier"
      }
    ],
    "pendingFields": [],
    "blocking": null,
    "trace": [
      {
        "step": "CompanyFiscalProfile",
        "status": "applied",
        "durationMs": 2.4
      },
      {
        "step": "ServiceTaxClassifier",
        "status": "applied",
        "durationMs": 7.1
      },
      {
        "step": "TaxApplicabilityResolver",
        "status": "applied",
        "durationMs": 0.3
      },
      {
        "step": "RtcTaxCalculator",
        "status": "skipped",
        "durationMs": 0.03,
        "reason": "MEI não destaca IBS/CBS na fase de teste de 2026"
      },
      {
        "step": "FiscalValidator",
        "status": "applied",
        "durationMs": 0.1
      }
    ]
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "accent", body: "`status: \"ready\"` significa que os dados fiscais estão completos e o cálculo foi feito. É uma estimativa pré-emissão, não uma autorização da Sefin. Valores e alíquotas vêm como strings decimais. A resposta nunca devolve o nome nem o CPF/CNPJ do cliente." },
            { kind: "callout", tone: "warn", body: "Problema fiscal não é erro HTTP: volta `200` com `status: \"blocked\"`, `blocking` (`code`, `message`, `step`) e `pendingFields[]` com o que falta, por exemplo `FISCAL_CLASSIFICATION_REQUIRED` ou `TAX_RATE_NOT_FOUND`. Os valores já calculados antes do bloqueio continuam na resposta. Entrada inválida segue o envelope normal (`404` empresa inexistente, `422` campo inválido)." },
            { kind: "callout", tone: "warn", body: "`503` com `Retry-After` (segundos) quando a Calculadora de tributos está indisponível: tente de novo depois, sem estimar. O limite é o mesmo de qualquer endpoint autenticado (`429` com `Retry-After`). Data de competência futura só até 15 dias à frente." },
          ],
        },
        { kind: "heading", level: 2, body: "Notas agendadas e recorrentes" },
        { kind: "text", body: "Use `options.type: \"SCHEDULE\"` para emitir uma nota uma única vez numa data futura, ou `options.type: \"RECURRING\"` para repeti-la toda semana, a cada duas semanas ou todo mês. Nenhum dos dois emite agora: criam uma **agenda**, e a resposta é a agenda (`202`), não uma nota. `competenceDate` é a data da primeira execução: de amanhã em diante e até 15 dias à frente (até 31 dias em `RECURRING`, para uma mensal poder começar hoje)." },
        { kind: "table", head: ["Situação", "Resultado"], rows: [
          ["Sem `options.type` (ou `IMMEDIATE`) e `competenceDate` futura", "`422` com `ERROR_FUTURE_DATE` em `details[].code`."],
          ["`SCHEDULE` ou `RECURRING` com `competenceDate` de amanhã em diante, até o limite (padrão 15 dias à frente)", "`202` com a agenda (`id`, `kind`, `status: active`, `next_run_on`). A nota só existe quando a agenda roda."],
          ["`SCHEDULE` ou `RECURRING` com `competenceDate` de hoje ou passada", "`422` com `first_date_too_soon` em `details[].code`. Para emitir agora, use `IMMEDIATE`."],
          ["`SCHEDULE` ou `RECURRING` além do limite", "`422` com `schedule_horizon_exceeded`."],
          ["`RECURRING` sem `options.recurrence.frequency`", "`422` com `required`. `recurrence` com `SCHEDULE` ou `IMMEDIATE` dá `422` com `not_allowed`."],
          ["`options.recurrence.endsOn` igual ou anterior à primeira data", "`422` com `ends_before_start`."],
          ["Mais de 200 agendas ativas na conta", "`422` com `ERROR_SCHEDULE_LIMIT`."],
        ] },
        { kind: "code", label: "Criar uma recorrência mensal", language: "bash", code: `curl -X POST "$BASE_URL/invoices" \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "companyTaxId": "11222333000181",
    "service": { "description": "Mensalidade" },
    "amount": 150,
    "competenceDate": "2026-11-10",
    "options": {
      "type": "RECURRING",
      "recurrence": { "frequency": "MONTHLY", "endsOn": "2027-10-10" }
    }
  }'` },
        { kind: "code", label: "Resposta: a agenda", language: "json", code: `{
  "data": {
    "id": "8f6c2b1e-0d4a-4c43-9c1a-2d7f5e3b9a10",
    "kind": "recurring",
    "frequency": "MONTHLY",
    "status": "active",
    "pause_reason": null,
    "company_id": "5b0e7c5a-5d0b-4f45-8d6c-3a2a1e9d7f20",
    "anchor_on": "2026-11-10",
    "next_run_on": "2026-11-10",
    "ends_on": "2027-10-10",
    "attempts": 0,
    "last_run_on": null,
    "invoice": { "amount": 150, "service": { "description": "Mensalidade" } },
    "created_at": "2026-11-06T15:00:00.000Z"
  }
}` },
        { kind: "callout", tone: "warn", body: "Mudança de contrato: `SCHEDULE` antes devolvia a nota (com `scheduledFor`); agora devolve a agenda. O `id` da resposta é o da agenda, e a nota aparece em `GET /v1/invoices` quando a agenda roda. O crédito deixa de ser reservado no cadastro: é consumido na execução. Notas agendadas antes da mudança continuam sendo emitidas normalmente. Agendas não são aceitas em lote (`POST /v1/invoices/batches`)." },
        { kind: "callout", tone: "accent", body: "As execuções acontecem às 09:00 de `America/Sao_Paulo`, de segunda a sexta. Uma data de sábado ou domingo roda na segunda-feira. A nota leva a competência do dia em que roda e usa os dados da agenda daquele momento. Se a execução não conseguir emitir (por exemplo, sem notas disponíveis), ela tenta de novo no dia útil seguinte e você recebe um e-mail; depois de 3 tentativas sem sucesso a agenda é pausada e você recebe outro e-mail. `POST /v1/schedules/:id/resume` retoma a partir da próxima data, sem recuperar o que passou." },
        { kind: "heading", level: 3, body: "Gerenciar agendas" },
        { kind: "table", head: ["Método", "Rota", "Descrição", "Status"], rows: [
          ["GET", "`/v1/schedules`", "Listar agendas (filtros `status` e `companyId`)", "200"],
          ["GET", "`/v1/schedules/:id`", "Consultar uma agenda", "200"],
          ["GET", "`/v1/schedules/:id/runs`", "Histórico de execuções: data prevista, dia em que rodou, resultado, nota emitida ou erro", "200"],
          ["PATCH", "`/v1/schedules/:id`", "Alterar `invoice`, `endsOn`, `frequency` ou `anchorOn`; vale para as próximas execuções", "200"],
          ["POST", "`/v1/schedules/:id/pause`", "Pausar", "200"],
          ["POST", "`/v1/schedules/:id/resume`", "Retomar uma agenda pausada", "200"],
          ["POST", "`/v1/schedules/:id/cancel`", "Cancelar (definitivo)", "200"],
        ] },
        { kind: "text", body: "A agenda tem `id`, `kind` (`once` ou `recurring`), `frequency`, `status` (`active`, `paused`, `completed`, `cancelled`), `pause_reason` (`customer` ou `failures`), `company_id`, `anchor_on`, `next_run_on`, `ends_on`, `attempts` (falhas seguidas, de 0 a 3), `last_run_on`, `invoice` (o corpo emitido a cada execução) e `created_at`. Permissões: `nfse.invoices.view` para ler e `nfse.invoices.issue` para criar e alterar. Uma chave de teste vê só agendas de teste, e uma de produção só as de produção." },
        { kind: "heading", level: 2, body: "Clientes salvos" },
        { kind: "text", body: "Depois que uma nota com tomador é aceita, a Corvo guarda o CPF ou CNPJ, o nome e o e-mail desse cliente. Na nota seguinte para o mesmo documento, basta enviar `customer.taxId`: o `name` vem do cadastro. O que você envia na requisição sempre vale, e a nota já emitida nunca muda." },
        { kind: "table", head: ["Regra", "Detalhe"], rows: [
          ["Escopo", "Um cadastro por documento em cada workspace e ambiente. `test` e `live` não se misturam."],
          ["Preenchimento", "Só o `name`, e só quando a requisição não traz nome. O e-mail salvo não é usado para enviar a nota."],
          ["Sem cadastro", "A nota segue como antes: sem `name`, o tomador sai como `Consumidor`. Envie o nome na primeira nota."],
          ["Atualização", "O nome salvo acompanha a nota mais recente; um e-mail já salvo é mantido quando a nota não traz e-mail."],
          ["Onde vale", "Nota avulsa, lote, planilha, agendas e recorrências, e as ferramentas do MCP."],
          ["Idempotência", "O hash da requisição é calculado antes do preenchimento, então repetir a mesma chamada continua devolvendo a mesma nota."],
        ] },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/customers",
          scopes: ["full_access", "invoices_view", "invoices_read_write"],
          success: "200 OK",
          summary: "Lista os clientes salvos do ambiente da chave, do mais recente para o mais antigo. `search` procura parte do nome ou o começo do CPF/CNPJ (a pontuação é ignorada).",
          params: {
            rows: [
              { name: "search", type: "string", required: false, description: "Parte do nome ou começo do documento." },
              { name: "limit", type: "number", required: false, description: "Itens por página (padrão 50)." },
              { name: "cursor", type: "string", required: false, description: "Cursor devolvido pela página anterior." },
            ],
          },
          examples: {
            curl: `curl "$BASE_URL/customers?search=acme&limit=50" \\
  -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/customers?search=acme&limit=50\`, {
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const { data } = await res.json();
console.log(data.map((customer) => customer.name));`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": [
    {
      "taxId": "11222333000181",
      "name": "Acme Ltda",
      "email": "financeiro@acme.com.br",
      "lastUsedAt": "2026-11-10T12:00:00.000Z",
      "createdAt": "2026-11-01T12:00:00.000Z",
      "updatedAt": "2026-11-10T12:00:00.000Z"
    }
  ],
  "pagination": { "limit": 50, "hasMore": false, "nextCursor": null }
}`,
          },
        },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/customers/:taxId",
          scopes: ["full_access", "invoices_view", "invoices_read_write"],
          success: "200 OK",
          summary: "Consulta um cliente salvo pelo CPF ou CNPJ, com ou sem pontuação. Responde `404` quando o documento nunca foi salvo.",
          examples: {
            curl: `curl "$BASE_URL/customers/11222333000181" \\
  -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/customers/11222333000181\`, {
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const { data } = await res.json();
console.log(res.status, data?.name); // 200 "Acme Ltda"`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": {
    "taxId": "11222333000181",
    "name": "Acme Ltda",
    "email": "financeiro@acme.com.br",
    "lastUsedAt": "2026-11-10T12:00:00.000Z",
    "createdAt": "2026-11-01T12:00:00.000Z",
    "updatedAt": "2026-11-10T12:00:00.000Z"
  }
}`,
          },
        },
        {
          kind: "endpoint",
          method: "PATCH",
          path: "/v1/customers/:taxId",
          scopes: ["full_access", "invoices_issue", "invoices_read_write"],
          success: "200 OK",
          summary: "Corrige o `name` ou o `email` de um cliente salvo. Envie só o que muda; `email: null` apaga o e-mail. A correção vale para as próximas notas.",
          params: {
            rows: [
              { name: "name", type: "string", required: false, description: "Novo nome, até 300 caracteres." },
              { name: "email", type: "string | null", required: false, description: "Novo e-mail, ou `null` para apagar." },
            ],
          },
          examples: {
            curl: `curl -X PATCH "$BASE_URL/customers/11222333000181" \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -H 'Content-Type: application/json' \\
  -d '{"name":"Acme S.A."}'`,
            node: `const res = await fetch(\`\${BASE_URL}/customers/11222333000181\`, {
  method: "PATCH",
  headers: { "X-API-Key": process.env.CORVO_API_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Acme S.A." }),
});
const { data } = await res.json();
console.log(data.name); // "Acme S.A."`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": {
    "taxId": "11222333000181",
    "name": "Acme S.A.",
    "email": "financeiro@acme.com.br",
    "lastUsedAt": "2026-11-10T12:00:00.000Z",
    "createdAt": "2026-11-01T12:00:00.000Z",
    "updatedAt": "2026-11-10T12:00:00.000Z"
  }
}`,
          },
        },
        {
          kind: "endpoint",
          method: "DELETE",
          path: "/v1/customers/:taxId",
          scopes: ["full_access", "invoices_issue", "invoices_read_write"],
          success: "200 OK",
          summary: "Apaga o cliente salvo. As notas já emitidas não mudam, e o nome deixa de ser preenchido.",
          examples: {
            curl: `curl -X DELETE "$BASE_URL/customers/11222333000181" \\
  -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/customers/11222333000181\`, {
  method: "DELETE",
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
console.log(res.status); // 200`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": null
}`,
          },
        },
        { kind: "callout", tone: "accent", body: "Permissões: `nfse.invoices.view` para listar e consultar; `nfse.invoices.issue` para corrigir e apagar. Cliente inexistente responde `404`." },
        { kind: "heading", level: 2, body: "Dedução da base do ISS" },
        { kind: "text", body: "O emitente pode declarar em `deduction` um valor que a legislação do município permite abater da base de cálculo do ISS. O valor vai na DPS em `vDedRed/vDR` e reduz a base do ISS; a nota continua sendo emitida pelo valor total (`amount`)." },
        { kind: "table", head: ["Campo / tributo", "Como é tratado"], rows: [
          ["`amount`", "Valor total da nota."],
          ["`deduction`", "Valor a abater da base do ISS. Maior que 0 e menor que `amount` menos `discount`; `0` equivale a omitir."],
          ["ISS", "Base = `amount` − `discount` − `deduction`."],
          ["Retenções federais", "Base inalterada: `amount` − `discount`."],
          ["IBS/CBS", "Calculado sobre o valor sem a dedução."],
          ["Líquido a receber", "Não muda com a dedução."],
          ["Erros de validação", "`422` com `out_of_range` (negativa, ou não menor que `amount` menos `discount`) ou `invalid_decimal_places` em `details[].code`, no `field: \"deduction\"`."],
          ["Resposta", "A nota devolve `deduction` quando uma dedução foi declarada."],
        ] },
        { kind: "code", label: "Nota com dedução", language: "bash", code: `curl -X POST "$BASE_URL/invoices" \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: pedido_123" \\
  -d '{
    "companyTaxId": "11222333000181",
    "service": { "description": "Serviço de manutenção" },
    "amount": 100,
    "deduction": 40,
    "competenceDate": "2026-10-20"
  }'` },
        { kind: "callout", tone: "warn", body: "O emitente declara o valor e responde por ele: a Corvo emite o que foi informado, não confere se a dedução é permitida para o serviço ou para o município e não substitui o seu contador. A aceitação da dedução pelo município e pelo sistema nacional ainda não foi homologada na Produção Restrita; se a nota for rejeitada, o motivo fica em `lastErrorCode` e `lastErrorMessage`." },
        { kind: "heading", level: 2, body: "Schema Invoice" },
        { kind: "text", body: "Cada nota tem estes campos:" },
        {
          kind: "table",
          head: ["Campos", "Tipo / observação"],
          rows: [
            ["`id`, `companyId`", "Strings de identificação."],
            ["`environment`", "`test` ou `live`."],
            ["`externalId`, `idempotencyKey`", "String ou null."],
            ["`status`", "Enum descrito abaixo."],
            ["`customerSnapshot`", "`taxId`, `name`, `email?`, `address?: { city, state, country? }`."],
            ["`serviceSnapshot`", "`description`, `code`, `municipalityCode`."],
            ["`taxSnapshot`", "Objeto de informações fiscais."],
            ["`amount`, `currency`, `competenceDate`", "Number em reais, moeda e data-hora ISO 8601 (a data de competência à meia-noite UTC, ex.: `2026-10-01T00:00:00.000Z`)."],
            ["`discount`, `deduction`", "Numbers opcionais em reais: desconto incondicional e dedução da base do ISS declarada pelo emitente (veja Dedução da base do ISS)."],
            ["`dpsId`, `dpsSeries`, `dpsNumber`", "String/string/number ou null."],
            ["`accessKey`, `nfseNumber`", "String/number ou null."],
            ["`fiscalProvider`, `fiscalSchemaVersion`", "Strings."],
            ["`issuedAt`, `authorizedAt`", "Data ISO ou null."],
            ["`emailSnapshot`", "Objeto opcional com `send`."],
            ["`lastErrorCode`, `lastErrorMessage`, `lastErrorProvider`", "String ou null."],
            ["`documentsReadyAt`", "Data ISO ou null."],
            ["`lastEmailStatus`, `lastEmailSentAt`", "`queued`, `sent`, `failed` ou null; data ISO ou null."],
            ["`documentsStatus`", "Estado derivado: `pending` ou `ready`."],
            ["`emailStatus`", "Estado derivado: `queued`, `sent`, `failed` ou null."],
            ["`stage`", "Estado derivado: `pending`, `authorized`, `documents_ready`, `completed`, `failed`."],
            ["`scheduledFor`", "Data ISO da liberação de uma nota agendada, ou null."],
            ["`cancellationReason`, `cancellationDescription`", "Motivo (`issue_error`, `service_not_provided` ou `other`) e justificativa do pedido de cancelamento, ou null."],
            ["`cancelledAt`", "Data ISO em que a nota chegou a `cancelled`, ou null."],
            ["`cancellationRequestedAt`", "Data ISO do pedido de cancelamento feito enquanto a nota estava `processing`, ou null. A nota é cancelada na Sefin assim que for autorizada."],
            ["`createdAt`, `updatedAt`", "Datas ISO."],
            ["`documentKeyVersion`", "Number opcional, quando presente no snapshot."],
          ],
        },
        {
          kind: "text",
          body: "`requestHash` é removido da serialização. O retorno atual usa `documentsReadyAt`/`documentsStatus`, e não o boolean `documentsReady` indicado por um DTO de Swagger. Não há objeto `lastEmail` no JSON atual; use os campos acima. `stage: completed` também pode ocorrer com email em `failed`; verifique `emailStatus` para saber se houve envio bem-sucedido.",
        },
        {
          kind: "text",
          body: "Status fiscais: `queued`, `processing`, `authorized`, `rejected`, `retry_pending`, `reconciliation_required`, `manual_review`, `failed`, `cancelling`, `cancelled`. Não interprete autorização como disponibilidade imediata de todos os documentos.",
        },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/invoices",
          scopes: ["full_access", "invoices_view", "invoices_read_write"],
          success: "200 OK",
          summary: "Lista notas com filtros e paginação por cursor.",
          params: {
            title: "Query",
            rows: [
              { name: "companyId", type: "string UUID", required: false, description: "UUID da empresa." },
              { name: "status", type: "string", required: false, description: "Um dos status fiscais: `queued`, `processing`, `authorized`, `rejected`, `retry_pending`, `reconciliation_required`, `manual_review`, `failed`, `cancelling`, `cancelled`." },
              { name: "from, to", type: "string ISO", required: false, description: "Datas ISO; filtro inclusivo pela competência, não por `createdAt`." },
              { name: "externalId", type: "string", required: false, description: "Correspondência exata." },
              { name: "limit", type: "integer", required: false, description: "Inteiro entre 1 e 1000; padrão `50`." },
              { name: "cursor", type: "string", required: false, description: "`nextCursor` da página anterior, mantendo os mesmos filtros." },
            ],
          },
          examples: {
            curl: `curl "$BASE_URL/invoices?status=authorized&limit=50" \\
  -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/invoices?status=authorized&limit=50\`, {
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const body = await res.json();
console.log(body.data, body.pagination.nextCursor); // { data: Invoice[], pagination }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": [
    {
      "id": "c7d2e9a1-4b5f-4a6c-8d9e-0f1a2b3c4d5e",
      "status": "authorized",
      "amount": 150.5,
      "createdAt": "2026-10-10T12:00:00.000Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "hasMore": true,
    "nextCursor": "eyJ2IjoxLCJjcmVhdGVkQXQiOiIyMDI2LTEwLTA5VDEyOjAwOjAwLjAwMDAwMFoiLCJpZCI6IjNmMWM4YTkwIn0"
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "warn", body: "Ordenação por `createdAt DESC` com desempate por ID. Continue com `pagination.nextCursor` até `hasMore: false`; inserções mais novas não aparecem na continuação e não há `total`." },
          ],
        },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/invoices/:id",
          scopes: ["full_access", "invoices_view", "invoices_read_write"],
          success: "200 OK",
          summary: "Consulta uma nota pelo id.",
          examples: {
            curl: `curl "$BASE_URL/invoices/$INVOICE_ID" \\
  -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/invoices/\${invoiceId}\`, {
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const body = await res.json();
console.log(body.data.status); // { data: Invoice }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": {
    "id": "c7d2e9a1-4b5f-4a6c-8d9e-0f1a2b3c4d5e",
    "status": "authorized",
    "accessKey": "352610123456789",
    "nfseNumber": 123,
    "documentsStatus": "ready"
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "warn", body: "Retorna `404` se a nota não estiver na conta/ambiente. Um `id` que não seja um UUID válido retorna `400` (`ERROR_BAD_REQUEST`)." },
          ],
        },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/invoices/:id/xml",
          scopes: ["full_access", "invoices_view", "invoices_read_write"],
          success: "200 OK",
          summary: "Baixa o XML da nota autorizada.",
          examples: {
            curl: `curl "$BASE_URL/invoices/$INVOICE_ID/xml" \\
  -H "X-API-Key: $CORVO_API_KEY" --fail --output nfse.xml`,
            node: `const res = await fetch(\`\${BASE_URL}/invoices/\${invoiceId}/xml\`, {
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const xml = await res.text(); // conteúdo XML bruto
console.log(xml.slice(0, 100));`,
          },
          response: { label: "200 OK", json: "" },
          notes: [
            { kind: "callout", tone: "accent", body: "Resposta binária, sem envelope JSON: `Content-Type: application/xml` e `Content-Disposition: attachment; filename=\"nfse-<numero-ou-id>.xml\"`. Exige nota `authorized`; nota não autorizada retorna `404`, e a disponibilidade também depende do armazenamento do documento." },
          ],
        },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/invoices/:id/pdf",
          scopes: ["full_access", "invoices_view", "invoices_read_write"],
          success: "200 OK",
          summary: "Baixa o PDF da nota autorizada.",
          examples: {
            curl: `curl "$BASE_URL/invoices/$INVOICE_ID/pdf" \\
  -H "X-API-Key: $CORVO_API_KEY" --fail --output nota.pdf`,
            node: `const res = await fetch(\`\${BASE_URL}/invoices/\${invoiceId}/pdf\`, {
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const buf = Buffer.from(await res.arrayBuffer()); // bytes PDF
console.log(buf.length);`,
          },
          response: { label: "200 OK", json: "" },
          notes: [
            { kind: "callout", tone: "accent", body: "Resposta binária, sem envelope JSON: `Content-Type: application/pdf` e `Content-Disposition: inline; filename=\"nfse-<numero-ou-id>.pdf\"`. Exige nota `authorized`; nota não autorizada retorna `404`, e a disponibilidade também depende do armazenamento." },
          ],
        },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/invoices/:id/events",
          scopes: ["full_access", "invoices_view", "invoices_read_write"],
          success: "200 OK",
          summary: "Consulta o histórico de transições de status da nota, do mais antigo ao mais recente. Paginado como qualquer lista (`limit`, `cursor`).",
          examples: {
            curl: `curl "$BASE_URL/invoices/$INVOICE_ID/events" \\
  -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/invoices/\${invoiceId}/events\`, {
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const body = await res.json();
console.log(body.data, body.pagination); // { data: InvoiceEvent[], pagination }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": [
    {
      "id": "e1f2a3b4-0c5d-4e6f-8a9b-1c2d3e4f5a6b",
      "invoiceId": "c7d2e9a1-4b5f-4a6c-8d9e-0f1a2b3c4d5e",
      "fromStatus": "queued",
      "toStatus": "authorized",
      "reason": null,
      "createdAt": "2026-10-10T12:01:00.000Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "hasMore": false,
    "nextCursor": null
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "accent", body: "Campos: `id`, `invoiceId`, `fromStatus` (string ou null), `toStatus`, `reason` (string ou null), `createdAt`." },
          ],
        },
        {
          kind: "endpoint",
          method: "POST",
          path: "/v1/invoices/:id/download-url",
          scopes: ["full_access", "invoices_view", "invoices_read_write"],
          success: "200 OK",
          summary: "Gera uma URL assinada e temporária para baixar o documento.",
          params: {
            rows: [
              { name: "format", type: "string", required: true, description: "`\"pdf\"` ou `\"xml\"`." },
            ],
          },
          examples: {
            curl: `curl -X POST "$BASE_URL/invoices/$INVOICE_ID/download-url" \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "format": "pdf" }'`,
            node: `const res = await fetch(\`\${BASE_URL}/invoices/\${invoiceId}/download-url\`, {
  method: "POST",
  headers: {
    "X-API-Key": process.env.CORVO_API_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ format: "pdf" }),
});
const body = await res.json();
console.log(body.data.downloadUrl); // { data: { downloadUrl, expiresAt, ... } }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": {
    "downloadUrl": "https://storage.example.com/documento-assinado",
    "expiresAt": "2026-10-10T15:00:00.000Z",
    "fileName": "nfse-123.pdf",
    "mimeType": "application/pdf"
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "accent", body: "A validade solicitada ao storage é de 3600 segundos e a resposta vem com `Cache-Control: no-store`. Use a URL retornada diretamente; proteja-a como credencial temporária." },
            { kind: "callout", tone: "warn", body: "A nota precisa estar autorizada e ter `documentsReadyAt`; caso contrário, `409`. Nota ausente: `404`. Storage indisponível: `503`." },
          ],
        },
        {
          kind: "endpoint",
          method: "POST",
          path: "/v1/invoices/:id/email",
          scopes: ["full_access", "invoices_issue", "invoices_read_write"],
          success: "202 Accepted",
          summary: "Solicita o envio de email com os documentos para o endereço armazenado em `customerSnapshot.email`.",
          examples: {
            curl: `curl -X POST "$BASE_URL/invoices/$INVOICE_ID/email" \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -H 'Idempotency-Key: pedido_123_email'`,
            node: `const res = await fetch(\`\${BASE_URL}/invoices/\${invoiceId}/email\`, {
  method: "POST",
  headers: {
    "X-API-Key": process.env.CORVO_API_KEY,
    "Idempotency-Key": "pedido_123_email",
  },
});
const body = await res.json();
console.log(body.data); // { data: { emailId, status } }`,
          },
          response: {
            label: "202 Accepted",
            json: `{
  "data": {
    "emailId": "pedido_123_email",
    "status": "queued"
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "accent", body: "Sem corpo de negócio: não aceita destinatário alternativo. Header opcional `Idempotency-Key`: 1–64 caracteres, somente letras, números, `_` e `-`; a deduplicação verifica a existência do job dessa nota/chave na fila. Em repetição, o status pode refletir o último estado do email. `202` não confirma entrega." },
            { kind: "callout", tone: "warn", body: "A nota precisa estar autorizada e com documentos prontos. Erros: `404` nota ausente; `409` documentos não prontos; `422` cliente sem email ou chave de idempotência inválida." },
          ],
        },
        {
          kind: "endpoint",
          method: "POST",
          path: "/v1/invoices/:id/cancel",
          scopes: ["full_access", "invoices_issue", "invoices_read_write"],
          success: "200 OK / 202 Accepted",
          summary: "Cancela uma nota. Uma nota `queued` (agendada ou ainda não processada) é cancelada na hora; uma NFS-e `authorized` passa a `cancelling` enquanto o evento 101101 é enviado à Sefin. Uma nota `processing` (em emissão) registra o pedido: `202`, ainda `processing`, com `cancellationRequestedAt` preenchido.",
          examples: {
            curl: `curl -X POST "$BASE_URL/invoices/$INVOICE_ID/cancel" \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -H 'Content-Type: application/json' \\
  -d '{"reason":"issue_error","description":"Valor do serviço informado incorretamente"}'`,
            node: `const res = await fetch(\`\${BASE_URL}/invoices/\${process.env.INVOICE_ID}/cancel\`, {
  method: "POST",
  headers: { "X-API-Key": process.env.CORVO_API_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ reason: "issue_error", description: "Valor do serviço informado incorretamente" }),
});
const body = await res.json();
console.log(res.status, body.data.status); // 202 "cancelling"`,
          },
          response: {
            label: "202 Accepted",
            json: `{
  "data": {
    "id": "6f1c0e2a-4b7d-4c1e-9a55-2b8f7c3d9e10",
    "status": "cancelling",
    "stage": "completed",
    "cancellationReason": "issue_error",
    "cancellationDescription": "Valor do serviço informado incorretamente",
    "cancelledAt": null,
    "cancellationRequestedAt": null
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "accent", body: "`reason`: `issue_error`, `service_not_provided` ou `other`. `description` é obrigatória (15–255 caracteres) para NFS-e autorizada e opcional para nota `queued`. Uma nota `processing` também exige `description`; assim que for autorizada, é cancelada automaticamente na Sefin sem devolver o crédito, e se a emissão terminar `rejected` ou `failed` o pedido é descartado e a reserva estornada como de costume. Repetir o pedido para uma nota `processing` (vale o primeiro pedido), `cancelling` ou `cancelled` devolve o estado atual." },
            { kind: "callout", tone: "warn", body: "`202` não confirma o cancelamento: aguarde `nfse.invoice.cancelled` ou `nfse.invoice.cancellation_rejected` (a nota volta a `authorized` com `lastErrorCode`). Cancelar uma NFS-e emitida não devolve o crédito; cancelar uma nota `queued` libera a reserva em live. Erros: `404` nota inexistente; `409` `ERROR_INVOICE_NOT_CANCELLABLE` (ex.: `retry_pending`, `reconciliation_required`, `manual_review`); `422` `ERROR_INVALID_CANCELLATION_REASON`. Se outro pedido já cancelou a nota, devolve o estado atual." },
          ],
        },
      ],
    },
    webhooks: {
      title: "Webhooks",
      description: "Cadastre endpoints e acompanhe as entregas de eventos.",
      blocks: [
        { kind: "text", body: "Permissões: `webhooks.view` para consultas; `webhooks.manage` para cadastro, exclusão, teste e retry." },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/webhooks",
          scopes: ["full_access", "invoices_read_write"],
          success: "200 OK",
          summary: "Lista as configurações de webhook da conta.",
          examples: {
            curl: `curl "$BASE_URL/webhooks" -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/webhooks\`, {
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const body = await res.json();
console.log(body.data, body.pagination); // { data: [{ id, url, events, active, ... }], pagination }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": [
    {
      "id": "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f",
      "url": "https://integracao.example.com/webhooks/corvo",
      "events": [
        "nfse.invoice.authorized",
        "nfse.invoice.documents_ready"
      ],
      "active": true,
      "createdAt": "2026-10-10T12:00:00.000Z",
      "updatedAt": "2026-10-10T12:00:00.000Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "hasMore": false,
    "nextCursor": null
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "accent", body: "A listagem não devolve `secret`." },
          ],
        },
        {
          kind: "endpoint",
          method: "POST",
          path: "/v1/webhooks",
          scopes: ["full_access"],
          success: "201 Created",
          summary: "Cadastra uma configuração de webhook.",
          params: {
            rows: [
              { name: "url", type: "string", required: true, description: "Deve incluir protocolo HTTP ou HTTPS e não apontar para hosts privados/loopback/link-local." },
              { name: "events", type: "string[]", required: true, description: "Array não vazio contendo somente eventos públicos aceitos (lista abaixo)." },
            ],
          },
          examples: {
            curl: `curl -X POST "$BASE_URL/webhooks" \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://integracao.example.com/webhooks/corvo",
    "events": [
      "nfse.invoice.authorized",
      "nfse.invoice.documents_ready",
      "nfse.invoice.email_sent",
      "nfse.invoice.email_failed"
    ]
  }'`,
            node: `const res = await fetch(\`\${BASE_URL}/webhooks\`, {
  method: "POST",
  headers: {
    "X-API-Key": process.env.CORVO_API_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    url: "https://integracao.example.com/webhooks/corvo",
    events: [
      "nfse.invoice.authorized",
      "nfse.invoice.documents_ready",
      "nfse.invoice.email_sent",
      "nfse.invoice.email_failed",
    ],
  }),
});
const body = await res.json();
console.log(body.data.secret); // guarde o secret agora`,
          },
          response: {
            label: "201 Created",
            json: `{
  "data": {
    "id": "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f",
    "url": "https://integracao.example.com/webhooks/corvo",
    "events": [
      "nfse.invoice.authorized",
      "nfse.invoice.documents_ready",
      "nfse.invoice.email_sent",
      "nfse.invoice.email_failed"
    ],
    "active": true,
    "createdAt": "2026-10-10T12:00:00.000Z",
    "updatedAt": "2026-10-10T12:00:00.000Z",
    "secret": "segredo-exibido-apenas-na-criacao"
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "accent", body: "Guarde o `secret` no momento do cadastro; ele não volta na listagem. `active` inicia como `true`." },
          ],
        },
        { kind: "heading", level: 2, body: "Eventos aceitos" },
        {
          kind: "list",
          items: [
            "`nfse.invoice.authorized`",
            "`nfse.invoice.rejected`",
            "`nfse.invoice.failed`",
            "`nfse.invoice.reconciliation_required`",
            "`nfse.invoice.manual_review`",
            "`nfse.invoice.documents_ready`",
            "`nfse.invoice.email_sent`",
            "`nfse.invoice.email_failed`",
            "`nfse.invoice.fiscal_discrepancy`",
            "`nfse.invoice.cancelled`",
            "`nfse.invoice.cancellation_rejected`",
          ],
        },
        {
          kind: "callout",
          tone: "warn",
          body: "`webhook.test` é usado pela rota de teste e não pode ser incluído no array de inscrições. A aceitação de um evento no cadastro não garante que todos os caminhos de falha do processamento atual o emitam; não dependa exclusivamente de `failed`/`reconciliation_required` sem consultar a nota.",
        },
        {
          kind: "endpoint",
          method: "DELETE",
          path: "/v1/webhooks/:id",
          scopes: ["full_access"],
          success: "200 OK",
          summary: "Exclui uma configuração de webhook.",
          examples: {
            curl: `curl -X DELETE "$BASE_URL/webhooks/$WEBHOOK_ID" \\
  -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/webhooks/\${webhookId}\`, {
  method: "DELETE",
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const body = await res.json();
console.log(body.data.deleted); // { data: { deleted: true } }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": {
    "deleted": true
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "warn", body: "Retorna `404` se a configuração estiver ausente na conta." },
          ],
        },
        {
          kind: "endpoint",
          method: "POST",
          path: "/v1/webhooks/:id/test",
          scopes: ["full_access"],
          success: "200 OK",
          summary: "Envia o evento `webhook.test` para a URL cadastrada.",
          examples: {
            curl: `curl -X POST "$BASE_URL/webhooks/$WEBHOOK_ID/test" \\
  -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/webhooks/\${webhookId}/test\`, {
  method: "POST",
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const body = await res.json();
console.log(body.data.sent); // { data: { sent: true } }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": {
    "sent": true
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "accent", body: "O evento é enviado sempre com ambiente `test`. Retorna `{ \"sent\": true }` quando seu endpoint responde `2xx`. Caso contrário a resposta continua `200`, com `{ \"sent\": false, \"statusCode\": 405, \"error\": \"...\" }` (`statusCode` é `null` se o endpoint não foi alcançado). A tentativa de teste não agenda os retries normais em caso de falha." },
          ],
        },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/webhooks/deliveries",
          scopes: ["full_access", "invoices_read_write"],
          success: "200 OK",
          summary: "Lista as entregas de webhook, ordenadas por criação decrescente.",
          params: {
            title: "Query",
            rows: [
              { name: "hours", type: "number", required: false, description: "Janela em horas (padrão `24`); fica fixa nas páginas seguintes." },
              { name: "limit", type: "integer", required: false, description: "Padrão `50`; aceita inteiros de 1 a 1000 (valor inválido retorna `400`)." },
              { name: "cursor", type: "string", required: false, description: "`nextCursor` da página anterior, mantendo os mesmos filtros." },
              { name: "environment", type: "string", required: false, description: "`test` ou `live`." },
            ],
          },
          examples: {
            curl: `curl "$BASE_URL/webhooks/deliveries?hours=24&limit=50" \\
  -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/webhooks/deliveries?hours=24&limit=50\`, {
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const body = await res.json();
console.log(body.data, body.pagination); // { data: WebhookDelivery[], pagination }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": [
    {
      "id": "d4e5f6a7-8b9c-4d0e-1f2a-3b4c5d6e7f8a",
      "eventType": "nfse.invoice.authorized",
      "environment": "test",
      "url": "https://integracao.example.com/webhooks/corvo",
      "statusCode": 200,
      "status": "sent",
      "retryCount": 0,
      "createdAt": "2026-10-10T12:02:00.000Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "hasMore": true,
    "nextCursor": "eyJ2IjoxLCJjcmVhdGVkQXQiOiIyMDI2LTEwLTA5VDEyOjAwOjAwLjAwMDAwMFoiLCJpZCI6IjNmMWM4YTkwIn0"
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "accent", body: "Campos: `id`, `webhookConfigId`, `eventType`, `environment`, `url`, `payload?`, `statusCode?`, `responseBody?`, `errorMessage?`, `status`, `durationMs?`, `retryCount`, `nextRetryAt?`, `lastError?`, `createdAt`. Status de entrega: `pending`, `sent`, `delayed`, `failed`, `manual_retry`. Sem o filtro `?environment`, a listagem pode retornar ambos os ambientes da conta." },
          ],
        },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/webhooks/deliveries/stats",
          scopes: ["full_access", "invoices_read_write"],
          success: "200 OK",
          summary: "Consulta estatísticas das entregas recentes.",
          params: {
            title: "Query",
            rows: [
              { name: "hours", type: "integer", required: false, description: "Padrão `24`." },
              { name: "environment", type: "string", required: false, description: "`test` ou `live`." },
            ],
          },
          examples: {
            curl: `curl "$BASE_URL/webhooks/deliveries/stats?hours=24" \\
  -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/webhooks/deliveries/stats?hours=24\`, {
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const body = await res.json();
console.log(body.data); // { data: { total, sent, failed, pending, delayed } }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": {
    "total": 10,
    "sent": 7,
    "failed": 1,
    "pending": 1,
    "delayed": 1
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "warn", body: "A implementação atual calcula sobre até 1000 entregas recentes. `manual_retry` entra no `total`, mas não tem contador próprio: a soma dos quatro contadores pode ser menor que `total`." },
          ],
        },
        {
          kind: "endpoint",
          method: "POST",
          path: "/v1/webhooks/deliveries/:id/retry",
          scopes: ["full_access"],
          success: "200 OK",
          summary: "Agenda nova tentativa de entrega de um webhook.",
          examples: {
            curl: `curl -X POST "$BASE_URL/webhooks/deliveries/$DELIVERY_ID/retry" \\
  -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/webhooks/deliveries/\${deliveryId}/retry\`, {
  method: "POST",
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const body = await res.json();
console.log(body.data.retried); // { data: { retried: true } }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": {
    "retried": true
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "warn", body: "Agenda a entrega com `status: manual_retry` e reinicia seu contador — não significa que o receptor já recebeu o evento. `404` para entrega ausente na conta." },
          ],
        },
      ],
    },
    credits: {
      title: "Créditos",
      description: "Saldo, planos, histórico e compra avulsa (descontinuada).",
      blocks: [
        { kind: "text", body: "Todas as quatro operações exigem `credits.view` e escopo `full_access`." },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/credits",
          scopes: ["full_access"],
          success: "200 OK",
          summary: "Consulta o saldo de créditos da conta.",
          examples: {
            curl: `curl "$BASE_URL/credits" -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/credits\`, {
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const body = await res.json();
console.log(body.data.balance); // { data: { balance, planRemaining, avulsoBalance, hardLimit } }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": {
    "balance": 100,
    "planRemaining": 0,
    "avulsoBalance": 0,
    "hardLimit": null
  }
}`,
          },
        },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/credits/plans",
          scopes: ["full_access"],
          success: "200 OK",
          summary: "Lista os planos disponíveis com seus limites e preços.",
          examples: {
            curl: `curl "$BASE_URL/credits/plans" -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/credits/plans\`, {
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const body = await res.json();
console.log(body.data, body.pagination); // { data: Plan[], pagination }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": [
    {
      "id": "3ec51af3-c715-4755-95da-c9b0951973dd",
      "slug": "solo",
      "name": "Developer",
      "description": "Para começar a emitir NFS-e em qualquer número de empresas",
      "monthlyCreditAllowance": 200,
      "dailyLimit": null,
      "maxActiveCompanies": 999999,
      "creditUnitPriceCents": 12,
      "throughputRps": 50,
      "includesWebhooks": true,
      "includesXmlDownload": true,
      "includesPdfDownload": true,
      "includesApiKeys": true,
      "supportTier": "email",
      "active": true,
      "createdAt": "2026-10-01T12:00:00.000Z",
      "updatedAt": "2026-10-01T12:00:00.000Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "hasMore": false,
    "nextCursor": null
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "accent", body: "Slugs definidos no domínio: `solo`, `equipe`, `empresa`, `escala` (e `free`, o placeholder interno de sem plano). Use o catálogo retornado para identificar planos disponíveis; não fixe preços na integração. `supportTier`: `community`, `email`, `priority`." },
          ],
        },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/credits/history",
          scopes: ["full_access"],
          success: "200 OK",
          summary: "Lista as transações de crédito da conta, ordenadas por criação decrescente.",
          params: {
            title: "Query",
            rows: [
              { name: "cursor", type: "string", required: false, description: "`nextCursor` da página anterior, mantendo os mesmos filtros." },
              { name: "limit", type: "integer", required: false, description: "Padrão `50`; aceita inteiros de 1 a 1000 (valor inválido retorna `400`)." },
            ],
          },
          examples: {
            curl: `curl "$BASE_URL/credits/history?limit=50" \\
  -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/credits/history?limit=50\`, {
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const body = await res.json();
console.log(body.data, body.pagination); // { data: CreditTransaction[], pagination }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": [
    {
      "id": "f0e1d2c3-b4a5-4b6c-8d7e-9f0a1b2c3d4e",
      "amount": 100,
      "type": "purchase",
      "description": "Compra avulsa",
      "createdAt": "2026-10-10T12:00:00.000Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "hasMore": true,
    "nextCursor": "eyJ2IjoxLCJjcmVhdGVkQXQiOiIyMDI2LTEwLTA5VDEyOjAwOjAwLjAwMDAwMFoiLCJpZCI6IjNmMWM4YTkwIn0"
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "warn", body: "`type`: `purchase`, `subscription_charge`, `topup`, `invoice_authorized`, `invoice_rejected`, `expiration`, `message_sent`, `refund`, `adjustment`, `bonus`. `source`: `subscription`, `avulso`, `bonus`. Campos terminados em `Cents` usam centavos; `amount` neste objeto representa créditos, não reais." },
          ],
        },
        {
          kind: "endpoint",
          method: "POST",
          path: "/v1/credits/purchase/preview",
          scopes: ["full_access"],
          success: "410 Gone",
          summary: "Descontinuado: notas avulsas agora são compradas em `POST /v1/billing/checkout` com `kind: \"avulso\"`.",
          params: {
            rows: [
              { name: "amountBrlCents", type: "integer", required: true, description: "Inteiro positivo, mínimo `1000` (R$ 10)." },
            ],
          },
          examples: {
            curl: `curl -X POST "$BASE_URL/credits/purchase/preview" \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "amountBrlCents": 1000 }'`,
            node: `const res = await fetch(\`\${BASE_URL}/credits/purchase/preview\`, {
  method: "POST",
  headers: {
    "X-API-Key": process.env.CORVO_API_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ amountBrlCents: 1000 }),
});
const body = await res.json();
console.log(res.status, body.code); // 410 "ERROR_GONE"`,
          },
          response: {
            label: "410 Gone",
            json: `{
  "statusCode": 410,
  "code": "ERROR_GONE",
  "message": "Notes are bought through POST /v1/billing/checkout with kind \"avulso\"",
  "requestId": "9f1fc995-4ee4-4a92-b285-cf8dff227a97"
}`,
          },
          notes: [
            { kind: "callout", tone: "warn", body: "Sempre responde `410 Gone` com `code: \"ERROR_GONE\"`. Para ter mais notas, compre notas avulsas (R$ 0,99 cada, a partir de 3) ou mude de plano em `POST /v1/billing/checkout`. Não há cobrança de excedente." },
          ],
        },
      ],
    },
    billing: {
      title: "Plano e cotas",
      description: "Consulta de plano, consumo, cota e mudança de plano.",
      blocks: [
        { kind: "text", body: "Consulta exige `billing.view`; alteração exige `billing.manage`. Todas as operações usam `full_access`." },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/billing/plan",
          scopes: ["full_access"],
          success: "200 OK",
          summary: "Consulta o plano atual e o consumo do período.",
          examples: {
            curl: `curl "$BASE_URL/billing/plan" -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/billing/plan\`, {
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const body = await res.json();
console.log(body.data.usage); // { data: { plan, subscription, usage } }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": {
    "plan": {
      "slug": "solo",
      "name": "Solo",
      "monthly_allowance": 100,
      "daily_limit": null,
      "max_active_companies": 999999,
      "monthly_price_cents": 5990
    },
    "usage": {
      "hard_limit": 100,
      "avulso_balance": 0,
      "credits_used": 10,
      "credits_reserved": 2,
      "credits_remaining": 188,
      "monthly_allowance": 200,
      "daily_usage": 3,
      "daily_limit": null,
      "active_companies": 1,
      "max_active_companies": 999999,
      "period_start": "2026-10-01T00:00:00.000Z",
      "period_end": "2026-10-31T23:59:59.000Z"
    },
    "subscription": {
      "status": "active",
      "paid_until": "2026-10-31T23:59:59.000Z",
      "cancel_at_period_end": false,
      "scheduled_plan": null,
      "blocked": false
    }
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "accent", body: "Valores ilustrativos. Esta rota usa `snake_case`, diferentemente de `billing/usage`. Ausência de plano após resolução: `404`." },
          ],
        },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/billing/usage",
          scopes: ["full_access"],
          success: "200 OK",
          summary: "Consulta a disponibilidade de emissão e as cotas do plano.",
          examples: {
            curl: `curl "$BASE_URL/billing/usage" -H "X-API-Key: $CORVO_API_KEY"`,
            node: `const res = await fetch(\`\${BASE_URL}/billing/usage\`, {
  headers: { "X-API-Key": process.env.CORVO_API_KEY },
});
const body = await res.json();
console.log(body.data.canEmit); // { data: QuotaStatus }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": {
    "canEmit": true,
    "creditsRemaining": 188,
    "creditsUsed": 10,
    "creditsReserved": 2,
    "monthlyAllowance": 200,
    "dailyUsage": 3,
    "dailyLimit": null,
    "activeCompanies": 1,
    "maxActiveCompanies": 10,
    "periodStart": "2026-10-01T00:00:00.000Z",
    "periodEnd": "2026-10-31T23:59:59.000Z"
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "accent", body: "`QuotaStatus`: `canEmit` (boolean), `reason?`, `creditsRemaining`, `creditsUsed`, `creditsReserved`, `monthlyAllowance`, `dailyUsage`, `dailyLimit` (number ou null), `activeCompanies`, `maxActiveCompanies`, `periodStart`, `periodEnd` (datas ou null). Reasons definidos: `no_credits`, `daily_limit_exceeded`, `company_limit_exceeded`, `plan_blocked`." },
            { kind: "callout", tone: "warn", body: "A consulta atual determina `canEmit` com créditos, limite diário e atividade do plano; não é garantia de que os dados fiscais/certificado de uma empresa estejam prontos. As consultas de cota podem inicializar o plano padrão e atualizar um período expirado." },
          ],
        },
        {
          kind: "endpoint",
          method: "POST",
          path: "/v1/billing/upgrade",
          scopes: ["dashboard"],
          success: "200 OK",
          summary: "Agenda a troca para o plano de destino na assinatura.",
          params: {
            rows: [
              { name: "plan_slug", type: "string", required: true, description: "Slug do plano de destino, por exemplo `growth`." },
            ],
          },
          examples: {
            curl: `curl -X POST "$BASE_URL/billing/upgrade" \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "plan_slug": "equipe" }'`,
            node: `const res = await fetch(\`\${BASE_URL}/billing/upgrade\`, {
  method: "POST",
  headers: {
    "X-API-Key": process.env.CORVO_API_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ plan_slug: "equipe" }),
});
const body = await res.json();
console.log(body.data); // { data: { scheduled_plan, effective_at } }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": {
    "scheduled_plan": "equipe",
    "effective_at": "2026-11-01T00:00:00.000Z"
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "warn", body: "Rota exclusiva do painel: chaves de API não têm acesso (`403`). Exige assinatura ativa (`409` caso contrário) e retorna `scheduled_plan` e `effective_at`; o checkout e o portal de cobrança também ficam no painel." },
          ],
        },
        {
          kind: "endpoint",
          method: "POST",
          path: "/v1/billing/downgrade",
          scopes: ["dashboard"],
          success: "200 OK",
          summary: "Agenda uma mudança de plano para o fim do período.",
          params: {
            rows: [
              { name: "plan_slug", type: "string", required: true, description: "Slug do plano de destino, por exemplo `developer`." },
            ],
          },
          examples: {
            curl: `curl -X POST "$BASE_URL/billing/downgrade" \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "plan_slug": "solo" }'`,
            node: `const res = await fetch(\`\${BASE_URL}/billing/downgrade\`, {
  method: "POST",
  headers: {
    "X-API-Key": process.env.CORVO_API_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ plan_slug: "solo" }),
});
const body = await res.json();
console.log(body.data); // { data: { scheduled_plan, effective_at } }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": {
    "scheduled_plan": "solo",
    "effective_at": "2026-11-01T00:00:00.000Z"
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "warn", body: "Rota exclusiva do painel: chaves de API não têm acesso (`403`). Exige assinatura ativa (`409` caso contrário) e retorna `scheduled_plan` e `effective_at`; o checkout e o portal de cobrança também ficam no painel." },
          ],
        },
        { kind: "heading", level: 2, body: "Catálogo público de planos" },
        { kind: "text", body: "Estas três rotas não exigem chave de API nem sessão: use-as para mostrar preços no seu site ou dimensionar um plano. Valores em centavos (`...Cents`) e o único ciclo é `monthly`; qualquer outro `cycle` retorna `400`." },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/plans",
          scopes: ["public"],
          success: "200 OK",
          summary: "Lista os planos com preço mensal e franquia.",
          params: {
            rows: [
              { name: "cycle", type: "string", required: false, description: "Só `monthly` é aceito (padrão)." },
              { name: "limit", type: "integer", required: false, description: "Padrão `50`; inteiro de 1 a 1000." },
              { name: "cursor", type: "string", required: false, description: "`nextCursor` da página anterior." },
            ],
          },
          examples: {
            curl: `curl "$BASE_URL/plans"`,
            node: `const res = await fetch(\`\${BASE_URL}/plans\`);
const { data: plans, pagination } = await res.json(); // { data: PlanQuote[], pagination }
console.log(plans.map((p) => p.slug), pagination.hasMore);`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": [
    {
      "slug": "solo",
      "name": "Solo",
      "monthlyAllowance": 100,
      "basePriceCents": 5990,
      "monthlyEquivalentCents": 5990,
      "chargeTotalCents": 5990,
      "currency": "BRL"
    }
  ],
  "pagination": {
    "limit": 50,
    "hasMore": false,
    "nextCursor": null
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "accent", body: "Ordenados da menor para a maior franquia. `monthlyAllowance` é o total de créditos incluídos, `perCreditOverageCents` o preço de cada crédito acima dela e `monthlyTotalCents` o preço mensal. Esta é a visão de preços; `GET /v1/credits/plans` devolve os limites e recursos do plano." },
          ],
        },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/plans/:slug",
          scopes: ["public"],
          success: "200 OK",
          summary: "Consulta o preço de um plano.",
          params: {
            rows: [
              { name: "cycle", type: "string", required: false, description: "Só `monthly` é aceito (padrão)." },
            ],
          },
          examples: {
            curl: `curl "$BASE_URL/plans/growth"`,
            node: `const res = await fetch(\`\${BASE_URL}/plans/growth\`);
const body = await res.json();
console.log(body.data.chargeTotalCents); // { data: PlanQuote }`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": {
    "slug": "equipe",
    "name": "Equipe",
    "monthlyAllowance": 250,
    "basePriceCents": 11990,
    "monthlyEquivalentCents": 11990,
    "chargeTotalCents": 11990,
    "currency": "BRL"
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "warn", body: "`slug` é `solo`, `equipe`, `empresa` ou `escala`. Um plano desconhecido retorna `404`." },
          ],
        },
        {
          kind: "endpoint",
          method: "GET",
          path: "/v1/plans/recommend",
          scopes: ["public"],
          success: "200 OK",
          summary: "Forma mais barata de cobrir N notas por mês: um plano, um plano mais notas avulsas ou só notas avulsas.",
          params: {
            rows: [
              { name: "notes", type: "integer", required: true, description: "Notas por mês, número inteiro de 1 a 1000000." },
              { name: "cycle", type: "string", required: false, description: "`monthly` (padrão) ou `annual` (30% de desconto, pago uma vez por ano)." },
            ],
          },
          examples: {
            curl: `curl "$BASE_URL/plans/recommend?notes=250"`,
            node: `const res = await fetch(\`\${BASE_URL}/plans/recommend?notes=250\`);
const body = await res.json();
console.log(body.data.option.planSlug, body.data.option.totalCents);`,
          },
          response: {
            label: "200 OK",
            json: `{
  "data": {
    "notes": 250,
    "cycle": "monthly",
    "option": { "planSlug": "equipe", "avulsoUnits": 0, "totalCents": 11990 },
    "alternatives": [
      { "planSlug": "empresa", "avulsoUnits": 0, "totalCents": 23990 }
    ],
    "currency": "BRL"
  }
}`,
          },
          notes: [
            { kind: "callout", tone: "warn", body: "`planSlug: null` significa sem plano, só notas avulsas. `totalCents` é o custo por mês no ciclo escolhido. Notas avulsas custam R$ 0,99 e são vendidas em lotes de no mínimo 3, então `avulsoUnits` é `0` ou pelo menos `3`. Não há cobrança de excedente. `notes` inválido retorna `400`." },
          ],
        },
      ],
    },
    "async-issuance": {
      title: "Emissão assíncrona",
      description: "A solicitação retorna imediatamente; o processamento continua em background.",
      blocks: [
        {
          kind: "text",
          body: "A emissão de NFS-e é assíncrona. O `POST /v1/invoices` responde `202` imediatamente com a nota registrada/enfileirada — normalmente com `status: \"queued\"` (ou `processing`) —, mas o sucesso HTTP não significa autorização fiscal: o processamento continua em background.",
        },
        { kind: "heading", level: 2, body: "Como acompanhar" },
        {
          kind: "list",
          items: [
            "`GET /v1/invoices/:id` — consulte o `status` e, quando disponível, `accessKey`/`nfseNumber`.",
            "`GET /v1/invoices/:id/events` — histórico de transições de status da nota.",
            "Webhooks — `nfse.invoice.authorized`, `nfse.invoice.documents_ready`, `nfse.invoice.email_sent` etc. (veja Recebendo webhooks).",
            "`GET /v1/billing/usage` — confira `canEmit` antes de novas emissões.",
          ],
        },
        {
          kind: "callout",
          tone: "warn",
          body: "Status fiscais: `queued`, `processing`, `authorized`, `rejected`, `retry_pending`, `reconciliation_required`, `manual_review`, `failed`, `cancelling`, `cancelled`. Não interprete autorização como disponibilidade imediata de todos os documentos — aguarde `documentsStatus: \"ready\"` antes de gerar URLs e solicitar emails.",
        },
        { kind: "heading", level: 2, body: "Idempotency-Key" },
        {
          kind: "text",
          body: "O header `Idempotency-Key` é opcional na emissão e na solicitação de email, mas recomendado: ele torna a repetição segura. Use uma chave estável por operação de negócio (por exemplo, o id do pedido no seu sistema) e mantenha a mesma chave e o mesmo payload em toda repetição.",
        },
        {
          kind: "text",
          body: "Mesma chave, conta e ambiente com conteúdo equivalente ao hash calculado recupera a mesma nota; conteúdo diferente retorna `409` (`ERROR_IDEMPOTENCY_CONFLICT`). O hash é calculado antes da normalização fiscal, com canonização das chaves JSON e da data de competência — não altere a representação dos campos ao repetir (CNPJ com e sem pontuação pode gerar hashes diferentes).",
        },
        {
          kind: "callout",
          tone: "warn",
          body: "Sem `Idempotency-Key` não há deduplicação: uma repetição após timeout pode emitir uma segunda nota. Na emissão, preserve a chave de idempotência e o payload em todo retry.",
        },
        {
          kind: "code",
          label: "javascript",
          language: "js",
          code: `async function emitirComRetry(payload, key, tentativas) {
  for (let i = 0; i < tentativas; i++) {
    const res = await fetch(\`\${BASE_URL}/invoices\`, {
      method: "POST",
      headers: {
        "X-API-Key": process.env.CORVO_API_KEY,
        "Content-Type": "application/json",
        // mesma chave em toda repetição — deduplicação no servidor
        "Idempotency-Key": key,
      },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const body = await res.json();
      return body.data.id; // { data: Invoice }
    }
    if (res.status !== 429 && res.status !== 503) {
      throw new Error(\`HTTP \${res.status}\`);
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** i)); // backoff exponencial
  }
  throw new Error("esgotado");
}

// uso: chave estável por operação de negócio
const invoiceId = await emitirComRetry(pedido, \`pedido_\${pedido.externalId}_emissao\`, 5);`,
        },
        {
          kind: "callout",
          tone: "accent",
          body: "Faça retry com backoff apenas para `429`/`503`, com o mesmo payload e a mesma `Idempotency-Key`. Não repita erros de validação sem corrigir os dados.",
        },
      ],
    },
    pagination: {
      title: "Paginação",
      description: "Paginação por cursor opaco em todas as listagens da API.",
      blocks: [
        {
          kind: "text",
          body: "Toda listagem retorna `{ \"data\": [...], \"pagination\": { \"limit\", \"hasMore\", \"nextCursor\" } }`. Não existem `page`, `pageSize`, `offset` nem `total`.",
        },
        { kind: "heading", level: 2, body: "Como paginar" },
        {
          kind: "list",
          items: [
            "Primeira chamada: `GET /v1/companies?limit=50`. `limit` aceita inteiros de 1 a 1000 (padrão `50`); valores inválidos retornam `400` com `ERROR_INVALID_LIMIT`, sem truncamento automático.",
            "Próximas páginas: envie `cursor=<nextCursor>` mantendo exatamente os mesmos filtros. Você pode mudar o `limit` entre páginas.",
            "No fim, `hasMore` é `false` e `nextCursor` é `null`. Uma lista vazia retorna `data: []`.",
            "O cursor é opaco e versionado: não o edite, construa ou reaproveite em outra coleção, tenant ou filtro (`400` com `ERROR_INVALID_CURSOR`).",
            "A leitura usa dados atuais, sem snapshot entre requisições: itens inseridos depois não aparecem na continuação de uma listagem descendente, e o cursor continua válido se o registro dele for excluído.",
          ],
        },
        {
          kind: "code",
          label: "javascript",
          language: "js",
          code: `async function listarTodasAsEmpresas() {
  const todas = [];
  let cursor;

  do {
    const url = new URL(\`\${BASE_URL}/companies\`);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url, {
      headers: { "X-API-Key": process.env.CORVO_API_KEY },
    });
    const { data, pagination } = await res.json();
    todas.push(...data);
    cursor = pagination.hasMore ? pagination.nextCursor : undefined;
  } while (cursor);

  return todas;
}`,
        },
        {
          kind: "callout",
          tone: "warn",
          body: "Em entregas de webhook (`GET /v1/webhooks/deliveries`) a janela de `hours` fica fixa nas páginas seguintes. Eventos de nota são ascendentes; planos mantêm a ordem comercial; as demais listagens são descendentes por data de criação.",
        },
      ],
    },
    "receiving-webhooks": {
      title: "Recebendo webhooks",
      description: "Formato das chamadas de saída, verificação de assinatura e política de repetição.",
      blocks: [
        {
          kind: "text",
          body: "A Corvo envia um `POST` JSON para a URL cadastrada. Responda com HTTP `2xx` em até 10 segundos; processamento demorado deve ser enfileirado pelo receptor.",
        },
        { kind: "heading", level: 2, body: "Formato da requisição" },
        {
          kind: "list",
          items: [
            "Método: `POST`.",
            "Headers: `Content-Type: application/json`, `X-Corvo-Signature: sha256=<hex>`.",
            "Corpo: envelope JSON com `id`, `type`, `environment`, `createdAt` e `data`.",
          ],
        },
        {
          kind: "code",
          label: "json",
          language: "json",
          code: `{
  "id": "evt_identificador",
  "type": "nfse.invoice.authorized",
  "environment": "test",
  "createdAt": "2026-10-10T14:00:00.000Z",
  "data": {
    "invoiceId": "UUID_DA_NOTA",
    "companyId": "UUID_DA_EMPRESA",
    "environment": "test",
    "status": "authorized",
    "documentsStatus": "pending",
    "emailStatus": null,
    "stage": "authorized",
    "accessKey": "CHAVE_DE_ACESSO",
    "nfseNumber": 123
  }
}`,
        },
        {
          kind: "text",
          body: "`data` varia por evento. No fluxo fiscal, inclui identificação e estado da nota; autorização acrescenta `accessKey`/`nfseNumber`, rejeição acrescenta `errorCode`/`errorMessage`, revisão manual acrescenta `reason`, documentos prontos acrescenta `accessKey`/`nfseNumber`/`documentsReadyAt`, email enviado acrescenta `sentAt`. O evento de teste contém `{ \"message\": \"This is a test webhook event\" }`.",
        },
        { kind: "heading", level: 2, body: "Tipos de evento" },
        {
          kind: "table",
          head: ["Evento", "`data` acrescenta ao estado da nota"],
          rows: [
            ["`nfse.invoice.authorized`", "`accessKey`, `nfseNumber`."],
            ["`nfse.invoice.rejected`", "`errorCode`, `errorMessage`."],
            ["`nfse.invoice.failed`", "Identificação e estado da nota."],
            ["`nfse.invoice.reconciliation_required`", "Identificação e estado da nota."],
            ["`nfse.invoice.manual_review`", "`reason`."],
            ["`nfse.invoice.documents_ready`", "`accessKey`, `nfseNumber`, `documentsReadyAt`."],
            ["`nfse.invoice.email_sent`", "`sentAt`."],
            ["`nfse.invoice.email_failed`", "Identificação e estado da nota."],
            ["`nfse.invoice.fiscal_discrepancy`", "`invoiceId`, `status` e `differences[]` (`field`, `local`, `authorized`, `delta`, `kind`): diferença entre o cálculo da Corvo e a NFS-e autorizada, acima de R$ 0,01 por tributo. O XML autorizado não é alterado."],
            ["`nfse.invoice.cancelled`", "A nota foi cancelada; inclui `reason`."],
            ["`nfse.invoice.cancellation_rejected`", "A Sefin recusou o cancelamento; a nota volta a `authorized`; inclui `errorCode` e `errorMessage`."],
            ["`webhook.test`", "`{ \"message\": \"This is a test webhook event\" }`."],
          ],
        },
        {
          kind: "callout",
          tone: "warn",
          body: "A aceitação de um evento no cadastro não garante que todos os caminhos de falha do processamento atual o emitam; não dependa exclusivamente de `failed`/`reconciliation_required` sem consultar a nota. `webhook.test` não pode ser inscrito.",
        },
        { kind: "heading", level: 2, body: "Verificação de assinatura" },
        {
          kind: "text",
          body: "A assinatura é HMAC-SHA256 do corpo JSON enviado, com o `secret` da configuração, em hexadecimal. Verifique os bytes brutos do corpo recebido — não faça parse e stringify antes de verificar.",
        },
        {
          kind: "code",
          label: "javascript",
          language: "js",
          code: `import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyWebhook(rawBody, signatureHeader, secret) {
  if (typeof signatureHeader !== 'string') return false;
  const match = /^sha256=([a-f0-9]{64})$/.exec(signatureHeader);
  if (!match) return false;
  const received = Buffer.from(match[1], 'hex');
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  return timingSafeEqual(received, expected);
}`,
        },
        {
          kind: "callout",
          tone: "warn",
          body: "Compare em tempo constante (`timingSafeEqual`) e sempre sobre os bytes brutos do corpo. A assinatura atual não inclui um timestamp separado de verificação — deduplicação por evento é necessária no receptor.",
        },
        { kind: "heading", level: 2, body: "Repetição e idempotência" },
        {
          kind: "list",
          items: [
            "O receptor pode receber novamente o mesmo evento: deduplique por `id` do envelope.",
            "Retries preservam o payload original.",
            "O outbox usa até 5 tentativas, com intervalos após falha de 60 segundos, 160 segundos, 15 minutos e 30 minutos; a execução depende do worker.",
            "Não assuma ordem global de entrega.",
          ],
        },
        {
          kind: "callout",
          tone: "accent",
          body: "Responda `2xx` rapidamente e processe de forma assíncrona: a janela de 10 segundos vale para a resposta HTTP, não para o trabalho em si.",
        },
      ],
    },
    "integration-checklist": {
      title: "Checklist de integração",
      description: "Sequência recomendada do primeiro acesso à produção.",
      blocks: [
        {
          kind: "list",
          items: [
            "Obter uma chave `test` com escopo adequado — cadastro de empresa/certificado exige `full_access`; uma chave `invoices_read_write` pode emitir com cadastro prévio.",
            "Cadastrar ou consultar a empresa no ambiente correspondente (`POST /v1/companies`, `GET /v1/companies/:id`).",
            "Verificar a prontidão da empresa: `status` deve ser `ready` e `setupGaps` vazio — o município fiscal (`municipality_code`) é obrigatório em todos os ambientes; em `live`, também é necessário o certificado ativo (`certificate`).",
            "Enviar o certificado A1 (.p12) com `POST /v1/companies/:companyId/certificates` — o CNPJ deve corresponder ao da empresa.",
            "Emitir a primeira nota no ambiente `test` com `POST /v1/invoices`, usando `Idempotency-Key` estável, e guardar `id`.",
            "Acompanhar o status por `GET /v1/invoices/:id` ou webhooks assinados — a emissão é assíncrona.",
            "Registrar um webhook (`POST /v1/webhooks`), guardar o `secret` e verificar a assinatura; conferir entregas em `GET /v1/webhooks/deliveries`.",
            "Aguardar os documentos prontos (`documentsStatus: \"ready\"`) para gerar a URL assinada e solicitar o email; conferir o estado do email separadamente (`emailStatus`).",
          ],
        },
        {
          kind: "callout",
          tone: "accent",
          body: "Para ir a `live`, a empresa precisa de certificado ativo correspondente ao CNPJ e créditos/cota disponíveis — consulte `GET /v1/billing/usage` (`canEmit`, `reason`) antes da primeira emissão de produção.",
        },
      ],
    },
    imports: importsPage("pt"),
    municipalities: municipalitiesPage("pt"),
    "payment-integrations": {
      title: "Integrações de pagamento",
      description: "Conecte Woovi, AbacatePay ou Stripe e emita a NFS-e automaticamente a cada pagamento confirmado.",
      blocks: [
        {
          kind: "text",
          body: "Conecte a conta da sua plataforma de pagamento à Corvo. Quando um pagamento é confirmado, a Corvo emite a NFS-e pelo mesmo caminho da API: valida a empresa e o certificado, consome um crédito do plano e envia a nota à prefeitura.",
        },
        { kind: "heading", level: 2, body: "Como funciona" },
        {
          kind: "list",
          items: [
            "No painel da Corvo, abra Integrações, escolha a plataforma e conecte sua conta. Copie o endereço do webhook exibido na configuração.",
            "Cadastre esse endereço no painel da plataforma de pagamento. A plataforma passa a avisar a Corvo a cada pagamento.",
            "A Corvo confere a autenticação do aviso, guarda o evento e responde na hora. O processamento acontece em segundo plano.",
            "Se o pagamento está confirmado e existe uma regra de serviço, a nota é emitida. A competência é a data da confirmação (fuso de São Paulo).",
            "O mesmo pagamento nunca gera duas notas, mesmo que a plataforma reenvie o aviso.",
          ],
        },
        { kind: "heading", level: 2, body: "Por plataforma" },
        { kind: "heading", level: 3, body: "Woovi" },
        {
          kind: "list",
          items: [
            "Não há credencial para informar. A Corvo gera um token de autenticação, exibido ao criar a conexão. Copie e guarde esse token. O ambiente `test` usa o sandbox da Woovi e `live` usa a conta de produção.",
            "Na Woovi, crie um webhook com o `webhookUrl` da conexão e o evento de cobrança paga (`OPENPIX:CHARGE_COMPLETED`). Em Cabeçalhos HTTP, adicione o cabeçalho `Authorization` com o `webhookToken` no campo Valor.",
            "O tomador da nota é o cliente da cobrança, nunca quem pagou o Pix.",
            "Cada cobrança vira uma nota, identificada pelo `correlationID`. A descrição do serviço na nota é o `comment` da cobrança; sem ele, vale o padrão da empresa.",
            "Reembolso: marque também `PIX_TRANSACTION_REFUND_SENT_CONFIRMED` no webhook. A Corvo liga o reembolso à venda pelo `endToEndId` do Pix. Reembolso parcial é ignorado.",
          ],
        },
        { kind: "heading", level: 3, body: "AbacatePay" },
        {
          kind: "list",
          items: [
            "Credencial: `apiKey`, uma chave de API v2 da AbacatePay (Integração > API > + Nova chave) com as permissões `CUSTOMER:READ` e `PRODUCT:READ`. A Corvo gera o `webhookSecret` e exibe o endereço completo do webhook ao criar a conexão. Copie e guarde esse endereço.",
            "Na AbacatePay, crie um webhook: cole o `webhookUrl` na URL e o segredo exibido ao criar a conexão no campo Secret, e marque `checkout.completed` e `transparent.completed`. A Corvo aceita a assinatura Standard Webhooks (`webhook-id`, `webhook-timestamp`, `webhook-signature`) e o formato antigo (`?webhookSecret=`).",
            "O `devMode` do evento precisa bater com o ambiente da conexão: eventos de teste não emitem nota em uma conexão `live`, e o inverso também.",
            "O webhook traz o CPF/CNPJ mascarado, então a Corvo consulta o cliente na AbacatePay com a sua chave e usa o documento completo. Se o cliente não tiver documento, a venda fica pendente (`customer_tax_id_missing`) ou sai sem tomador se a regra tiver `allowAnonymousCustomer`.",
            "O `externalProductId` das regras é o `id` do item do checkout. A descrição do serviço na nota é o nome do produto (a Corvo o consulta pela chave); sem a permissão `PRODUCT:READ`, vale o padrão da empresa.",
            "Reembolso: marque também `checkout.refunded` e `transparent.refunded` no webhook. Sem o cancelamento automático, o reembolso ou a contestação depois da nota abre a pendência `refund_after_invoice` e a nota não é cancelada.",
          ],
        },
        { kind: "heading", level: 2, body: "Vendas que precisam de atenção" },
        {
          kind: "text",
          body: "Quando uma venda não pode virar nota sozinha, consulte a pendência e o motivo na lista de vendas da integração, no painel da Corvo.",
        },
        {
          kind: "table",
          head: ["blockReason", "O que fazer"],
          rows: [
            ["`customer_tax_id_missing`", "A plataforma não enviou CPF/CNPJ completo. Complete os dados do tomador na venda e tente emitir novamente pelo painel."],
            ["`no_rule` / `ambiguous_rule`", "Crie ou ajuste as regras e tente novamente pelo painel."],
            ["`invoice_rejected`", "A validação fiscal recusou o pedido. A mensagem explica o campo; corrija e tente novamente pelo painel."],
            ["`quota_exceeded`", "Sem créditos ou limite do plano. Depois de resolver, tente novamente pelo painel."],
            ["`connection_inactive`", "A conexão está pausada ou precisa de nova autorização. Reative e tente novamente pelo painel."],
            ["`company_not_ready`", "A empresa não está pronta ou o certificado está ausente, vencido ou inválido. Corrija o cadastro e tente novamente pelo painel."],
            ["`before_active_from`", "O pagamento é anterior à data de início da conexão. Nenhuma nota é emitida."],
            ["`refunded` / `disputed`", "O pagamento foi reembolsado ou contestado antes da nota. Nenhuma nota é emitida."],
            ["`refund_after_invoice`", "Reembolso ou contestação chegou depois da nota e o cancelamento automático está desligado. A nota continua autorizada. Para cancelar, solicite o cancelamento na página da nota; para os próximos reembolsos, ative o cancelamento automático nas configurações da integração (contestação nunca cancela)."],
            ["`cancel_requested`", "Nada a fazer: a Corvo pediu o cancelamento da nota (motivo \"Cancelado por reembolso\"). Acompanhe o resultado na página da nota."],
            ["`cancel_failed`", "Não foi possível pedir o cancelamento (por exemplo, a nota está num estado que não permite). Veja a nota e, se puder cancelar, tente novamente pelo painel."],
          ],
        },
        {
          kind: "callout",
          tone: "warn",
          body: "Por padrão, reembolso ou contestação não cancela a nota. Para cancelar sozinho no reembolso, ative o cancelamento automático por reembolso nas configurações da integração: a Corvo pede o cancelamento com o motivo \"Cancelado por reembolso\" (o crédito da nota não volta). Contestação nunca cancela. Para cancelar manualmente, solicite o cancelamento na página da nota.",
        },
        {
          kind: "callout",
          tone: "accent",
          body: "O ambiente (`test` ou `live`) é definido na conexão. Se a plataforma informar que o evento é de outro ambiente, a Corvo descarta o evento e não emite nota.",
        },
        { kind: "heading", level: 2, body: "Pela API" },
        {
          kind: "text",
          body: "Tudo o que o painel faz nas integrações de pagamento também está disponível pela API, com uma chave de API (`X-API-Key`).",
        },
        {
          kind: "table",
          head: ["Método", "Rota", "Descrição"],
          rows: [
            ["GET", "`/v1/integrations/providers`", "Plataformas disponíveis e os campos de credencial de cada uma"],
            ["POST", "`/v1/integrations/connections`", "Criar uma conexão"],
            ["GET", "`/v1/integrations/connections`", "Listar conexões"],
            ["GET", "`/v1/integrations/connections/:id`", "Consultar uma conexão"],
            ["POST", "`/v1/integrations/connections/:id/validate`", "Conferir as credenciais e identificar a conta"],
            ["POST", "`/v1/integrations/connections/:id/activate`", "Começar a emitir automaticamente"],
            ["POST", "`/v1/integrations/connections/:id/pause`", "Parar de emitir; os eventos continuam guardados"],
            ["POST", "`/v1/integrations/connections/:id/disconnect`", "Desconectar de vez"],
            ["GET", "`/v1/integrations/connections/:id/rules`", "Consultar as regras de serviço"],
            ["PUT", "`/v1/integrations/connections/:id/rules`", "Substituir as regras de serviço"],
            ["GET", "`/v1/integrations/connections/:id/events`", "Eventos recebidos"],
            ["GET", "`/v1/integrations/connections/:id/operations`", "Vendas e o status da nota de cada uma"],
            ["PATCH", "`/v1/integrations/operations/:id/customer`", "Preencher o tomador de uma venda pendente"],
            ["POST", "`/v1/integrations/operations/:id/retry`", "Tentar emitir de novo"],
            ["POST", "`/v1/integrations/inbound/:publicId`", "Endereço que a plataforma de pagamento chama (público, autenticado pelo conector)"],
          ],
        },
        {
          kind: "callout",
          tone: "accent",
          body: "As rotas de gestão exigem `integrations.view` (leitura) ou `integrations.manage` (criar, ativar, alterar regras). Chaves `full_access` têm as duas.",
        },
        {
          kind: "code",
          label: "1. Criar a conexão",
          language: "bash",
          code: `curl -X POST "$BASE_URL/v1/integrations/connections" \
  -H "X-API-Key: $CORVO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "woovi",
    "companyId": "<id da empresa>",
    "environment": "test",
    "credentials": {},
    "activeFrom": "2026-11-01T00:00:00Z"
  }'`,
        },
        {
          kind: "code",
          label: "2. Definir a regra de serviço e ativar",
          language: "bash",
          code: `curl -X PUT "$BASE_URL/v1/integrations/connections/$CONNECTION_ID/rules" \
  -H "X-API-Key: $CORVO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "rules": [ { "service": { "code": "010101", "description": "Consultoria" }, "sendEmail": true } ] }'

curl -X POST "$BASE_URL/v1/integrations/connections/$CONNECTION_ID/validate" -H "X-API-Key: $CORVO_API_KEY"
curl -X POST "$BASE_URL/v1/integrations/connections/$CONNECTION_ID/activate" -H "X-API-Key: $CORVO_API_KEY"`,
        },
        {
          kind: "text",
          body: "Uma regra sem `externalProductId` vale para qualquer produto. Para dar outro serviço a um produto, envie outra regra com o `externalProductId` dele. Pagamentos anteriores a `activeFrom` são ignorados.",
        },
        {
          kind: "text",
          body: "Uma venda que não virou nota aparece em `GET /v1/integrations/connections/:id/operations` com `fiscalStatus` e `blockReason` (veja a tabela acima). Corrija com `PATCH /v1/integrations/operations/:id/customer` ou ajustando as regras e chame `POST /v1/integrations/operations/:id/retry`. Para cancelar uma nota depois de um reembolso, use `POST /v1/invoices/:id/cancel`.",
        },
      ],
    },
    "mcp": {
      "title": "Agentes de IA (MCP)",
      "description": "Conecte Claude Code, Claude Desktop, Cursor, VS Code, Codex e Windsurf à Corvo por OAuth.",
      "blocks": [
        {
          "kind": "text",
          "body": "O servidor MCP da Corvo deixa agentes de IA (Claude Code, Cursor e outros clientes MCP) emitirem e consultarem NFS-e em nome de um usuário, sem você escrever integração. O agente se conecta por OAuth: abre o navegador, você entra na Corvo, escolhe o workspace e aprova. Nenhuma chave de API é copiada."
        },
        {
          "kind": "heading",
          "level": 2,
          "body": "Conectar um agente"
        },
        {
          "kind": "text",
          "body": "Use a URL do servidor abaixo. Ela também aparece no painel, em Agentes de IA, com os comandos prontos para copiar."
        },
        {
          "kind": "code",
          "label": "Claude Code",
          "language": "bash",
          "code": "claude mcp add --transport http corvo https://api.corvo.tech/mcp"
        },
        {
          "kind": "code",
          "label": "Cursor (.cursor/mcp.json)",
          "language": "json",
          "code": "{\n  \"mcpServers\": {\n    \"corvo\": {\n      \"url\": \"https://api.corvo.tech/mcp\"\n    }\n  }\n}"
        },
        {
          "kind": "code",
          "label": "VS Code (.vscode/mcp.json)",
          "language": "json",
          "code": "{\n  \"servers\": {\n    \"corvo\": {\n      \"type\": \"http\",\n      \"url\": \"https://api.corvo.tech/mcp\"\n    }\n  }\n}"
        },
        {
          "kind": "code",
          "label": "Codex (~/.codex/config.toml)",
          "language": "text",
          "code": "[mcp_servers.corvo]\nurl = \"https://api.corvo.tech/mcp\""
        },
        {
          "kind": "code",
          "label": "Windsurf (mcp_config.json)",
          "language": "json",
          "code": "{\n  \"mcpServers\": {\n    \"corvo\": {\n      \"serverUrl\": \"https://api.corvo.tech/mcp\"\n    }\n  }\n}"
        },
        {
          "kind": "heading",
          "level": 3,
          "body": "Claude Desktop"
        },
        {
          "kind": "list",
          "items": [
            "Abra Configurações → Conectores (Connectors).",
            "Clique em Adicionar conector personalizado, informe um nome (Corvo) e cole a URL do servidor.",
            "Clique em Conectar e aprove o acesso no navegador.",
            "URL: `https://api.corvo.tech/mcp`"
          ]
        },
        {
          "kind": "callout",
          "tone": "warn",
          "body": "Ainda não verificado com o OAuth da Corvo: os formatos de VS Code, Codex, Windsurf e Claude Desktop seguem a documentação pública de cada cliente e o painel. Se algum não conectar, use o painel (Agentes de IA) e nos avise."
        },
        {
          "kind": "code",
          "label": "Prompt de teste",
          "language": "text",
          "code": "Liste minhas empresas na Corvo e emita uma NFS-e de teste de R$ 100."
        },
        {
          "kind": "list",
          "items": [
            "Adicione o servidor no agente com a URL `https://api.corvo.tech/mcp`.",
            "O agente abre o navegador na tela de aprovação da Corvo. Se você não estiver logado, entre primeiro; depois volta para a aprovação.",
            "Escolha o workspace e clique em Permitir (ou Negar).",
            "Volte ao agente. Ele já recebe as ferramentas da Corvo."
          ]
        },
        {
          "kind": "callout",
          "tone": "warn",
          "body": "Ao aprovar, você escolhe o ambiente da conexão: `test` (notas sem valor fiscal) ou `live` (notas reais, com consumo de créditos). Cada conexão fica em um ambiente; para trocar, reconecte o agente. Comece pelo teste."
        },
        {
          "kind": "heading",
          "level": 2,
          "body": "Permissões"
        },
        {
          "kind": "table",
          "head": [
            "Escopo",
            "O que permite",
            "Papéis que podem conceder"
          ],
          "rows": [
            [
              "`nfse:read`",
              "Consultar, listar e baixar o PDF de notas",
              "admin, developer, billing"
            ],
            [
              "`nfse:write`",
              "Emitir notas",
              "admin, developer"
            ]
          ]
        },
        {
          "kind": "text",
          "body": "Um membro só consegue aprovar escopos que o próprio papel no workspace permite. Um workspace em que o seu papel não cobre o pedido aparece desabilitado na tela de aprovação."
        },
        {
          "kind": "heading",
          "level": 2,
          "body": "Ferramentas"
        },
        {
          "kind": "table",
          "head": [
            "Ferramenta",
            "Escopo",
            "Entrada principal",
            "Saída"
          ],
          "rows": [
            [
              "`nfse_issue`",
              "`nfse:write`",
              "`company_tax_id` (CNPJ) ou `company_id`, `amount` (ou `services [{description, quantity, unit_price}]`), `customer? {tax_id, name?, email?}` (`tax_id` obrigatório quando há tomador), `description?`, `discount?`, `deduction?` (dedução da base do ISS declarada pelo emitente), `purchase_order?` (nº do pedido, até 60 caracteres), `notes?` (texto livre impresso na nota), `competence_date?` (padrão: hoje), `emission_type?` (`IMMEDIATE`/`SCHEDULE`/`RECURRING`), `recurrence_frequency?` (`WEEKLY`/`BIWEEKLY`/`MONTHLY`, obrigatório com `RECURRING`), `recurrence_ends_on?`, `send_email?`, `service_code?`, `external_id?`, `idempotency_key?`",
              "`{ invoice_id, access_key, status }`; com `SCHEDULE` ou `RECURRING`, `{ schedule_id, kind, frequency, status, next_run_on, ends_on }`"
            ],
            [
              "`schedule_list`",
              "`nfse:read`",
              "`status?`, `company_id?`, `limit?`, `offset?`",
              "`{ schedules [...], total, limit, offset }`"
            ],
            [
              "`schedule_get`",
              "`nfse:read`",
              "`schedule_id`",
              "a agenda"
            ],
            [
              "`schedule_runs`",
              "`nfse:read`",
              "`schedule_id`, `limit?`, `offset?`",
              "`{ runs [{ occurrence_on, ran_on, attempt, outcome, invoice_id?, error_code?, error_message? }], total }`"
            ],
            [
              "`schedule_update`",
              "`nfse:write`",
              "`schedule_id` e o que muda: `amount?`, `description?`, `purchase_order?`, `notes?` (texto vazio remove), `customer?`, `send_email?`, `ends_on?` (ou `null`), `frequency?`, `first_date?`",
              "a agenda"
            ],
            [
              "`schedule_pause`",
              "`nfse:write`",
              "`schedule_id`",
              "a agenda"
            ],
            [
              "`schedule_resume`",
              "`nfse:write`",
              "`schedule_id`",
              "a agenda"
            ],
            [
              "`schedule_cancel`",
              "`nfse:write`",
              "`schedule_id`",
              "a agenda"
            ],
            [
              "`import_create`",
              "`nfse:write`",
              "`content` (CSV) ou `content_base64` (.xlsx), `file_name?`, `company_id?`; até 1 MB e 2.000 linhas",
              "`{ id, status, duplicate_of }`; a leitura é assíncrona"
            ],
            [
              "`import_list`",
              "`nfse:read`",
              "`limit?` (1 a 20)",
              "`{ imports [...] }` com contadores, das mais novas para as mais antigas"
            ],
            [
              "`import_get`",
              "`nfse:read`",
              "`import_id`",
              "a importação: `status`, `rows_expected`, `counters` (`valid_amount`, `awaiting_credits`...)"
            ],
            [
              "`import_rows`",
              "`nfse:read`",
              "`import_id`, `status?`, `cursor?`, `limit?` (até 200)",
              "`{ rows [{ line, data, status, error_code, error_message, invoice_id }], next_cursor, has_more }`"
            ],
            [
              "`import_fix_row`",
              "`nfse:write`",
              "`import_id`, `line`, `item`",
              "a linha, conferida de novo (`valid` ou `invalid` com o motivo)"
            ],
            [
              "`import_emit`",
              "`nfse:write`",
              "`import_id`",
              "a importação, `emitting`; chame de novo depois de recarregar créditos para enviar só as `awaiting_credits`"
            ],
            [
              "`import_discard`",
              "`nfse:write`",
              "`import_id`",
              "`{ import_id, discarded: true }`"
            ],
            [
              "`company_list`",
              "`nfse:read`",
              "`tax_id?` (CNPJ), `limit?`, `cursor?`",
              "`{ companies [{ id, legal_name, tax_id, status, tax_regime, setup_gaps, ready_to_issue }], next_cursor }`"
            ],
            [
              "`nfse_issue_batch`",
              "`nfse:write`",
              "`invoices` (1 a 50 itens, cada um com os mesmos campos de `nfse_issue`, incluindo `company_tax_id` ou `company_id` e `idempotency_key`)",
              "`{ total, accepted, rejected, results [{ index, status, replayed?, invoice_id?, access_key?, invoice_status?, error? }] }`; itens inválidos são rejeitados no lugar e os válidos são salvos juntos"
            ],
            [
              "`company_get`",
              "`nfse:read`",
              "`tax_id` (CNPJ)",
              "`{ company }` ou `{ company: null }`"
            ],
            [
              "`company_create`",
              "`nfse:write`",
              "`legal_name`, `tax_id`, `tax_regime`, `municipality_code`, `simples_rate` (obrigatório no Simples Nacional), `simples_iss_rate?` e dados fiscais opcionais",
              "`{ id, legal_name, tax_id, status }`; certificado continua somente pela API"
            ],
            [
              "`nfse_calculate`",
              "`nfse:read`",
              "`company_tax_id` ou `company_id`, `amount`, mais `discount`, `deduction` e dados fiscais opcionais",
              "Resultado da apuração sem emitir, reservar crédito ou criar DPS"
            ],
            [
              "`billing_usage`",
              "`nfse:read`",
              "Sem parâmetros",
              "`QuotaStatus` com `canEmit`, franquia e uso"
            ],
            [
              "`nfse_cancel`",
              "`nfse:write`",
              "`invoice_id`, `reason` (`issue_error`, `service_not_provided` ou `other`), `description?` (15–255 caracteres, obrigatória para NFS-e autorizada ou em emissão)",
              "`{ invoice_id, status, cancelled_at }` (`cancelled`, `cancelling` ou `processing` com o pedido registrado)"
            ],
            [
              "`nfse_query`",
              "`nfse:read`",
              "`access_key`",
              "`{ access_key, status, nfse_number, authorized_at, last_error }`"
            ],
            [
              "`nfse_list`",
              "`nfse:read`",
              "`status?`, `limit?`, `cursor?`",
              "`{ invoices, next_cursor }`"
            ],
            [
              "`nfse_download_pdf`",
              "`nfse:read`",
              "`access_key` (nota autorizada)",
              "`{ access_key, pdf_base64 }`"
            ],
            [
              "`nfse_get_download_url`",
              "`nfse:read`",
              "`access_key`, `format` (`pdf` ou `xml`; nota autorizada)",
              "`{ download_url, expires_at, file_name, mime_type }` (URL assinada, válida por 1 hora)"
            ]
          ]
        },
        {
          "kind": "text",
          "body": "A chamada mais simples é `company_tax_id` mais `amount`: o tomador é opcional (omita para uma nota sem tomador; se enviar, `tax_id` é obrigatório), a data de competência é hoje por padrão, o código de serviço vem da empresa ou, sem ele, `100901` (LC 116 item 10.09), e a descrição vem do nome do código de serviço. Use `company_get` para consultar um CNPJ específico e `billing_usage` antes de emitir. Certificados A1 não são expostos no MCP e devem ser enviados somente pela API. Falhas das ferramentas voltam como resultado com `isError: true` e a mensagem em texto, para o agente ler e corrigir."
        },
        {
          "kind": "heading",
          "level": 2,
          "body": "Ver uso e revogar"
        },
        {
          "kind": "list",
          "items": [
            "No painel, abra Agentes de IA → Aplicativos conectados: você vê cada agente, o workspace, as permissões, o último uso e quantas chamadas e notas emitidas ele fez.",
            "Clique em Revogar para cortar o acesso na hora. O agente precisa ser aprovado de novo para voltar.",
            "Administradores do workspace veem e podem revogar as conexões de todos os membros; os demais veem só as próprias.",
            "Reconectar o mesmo agente reaproveita a conexão e revoga a sessão anterior."
          ]
        }
      ]
    },
    "llms": {
      "title": "Integrar com IA (llms.txt)",
      "description": "Entregue o llms.txt ao seu agente de código e deixe que ele implemente a integração com a Corvo.",
      "blocks": [
        {
          "kind": "text",
          "body": "A Corvo publica a documentação em um formato feito para agentes de IA que programam. Entregue o endereço ao seu agente (Claude Code, Cursor, Codex, Copilot e outros) e ele lê a API e escreve a integração no seu projeto, seguindo as mesmas regras desta documentação."
        },
        {
          "kind": "heading",
          "level": 2,
          "body": "O que entregar ao agente"
        },
        {
          "kind": "table",
          "head": [
            "Arquivo",
            "Endereço",
            "Uso"
          ],
          "rows": [
            [
              "`llms.txt`",
              "`https://www.corvo.tech/llms.txt`",
              "Índice curto com os fatos principais e um link para cada página da documentação. O agente abre só o que precisa."
            ],
            [
              "`llms-full.txt`",
              "`https://www.corvo.tech/llms-full.txt`",
              "Toda a documentação em um único arquivo Markdown (em inglês): endpoints, campos, exemplos e erros. O melhor quando o agente deve implementar tudo de uma vez."
            ]
          ]
        },
        {
          "kind": "heading",
          "level": 2,
          "body": "Prompt pronto para usar"
        },
        {
          "kind": "text",
          "body": "Copie, preencha o trecho entre colchetes e cole no seu agente. Ele aponta para o `llms-full.txt` e define as regras que importam: ambiente de teste, chave fora do código, idempotência e emissão assíncrona."
        },
        {
          "kind": "code",
          "label": "Prompt",
          "language": "text",
          "code": "Leia https://www.corvo.tech/llms-full.txt (a documentação da API de NFS-e da Corvo) e integre a emissão de notas neste projeto.\n\nMinha stack e onde as notas são criadas: [descreva a linguagem/framework e o ponto do código em que um pedido ou venda vira nota].\n\nSiga estas regras:\n- Use o ambiente de teste. Leia a chave da variável de ambiente CORVO_API_KEY (começa com corvo_test_). Nunca escreva uma chave no código, nos testes ou em commits.\n- Cadastre a empresa uma única vez com POST /v1/companies (taxId, taxRegime, municipalityCode) e guarde o id.\n- Antes de emitir, chame POST /v1/invoices/calculate e mostre os tributos quando fizer sentido.\n- Emita com POST /v1/invoices e envie um Idempotency-Key montado com o id do meu pedido, para que uma nova tentativa nunca crie uma segunda nota.\n- A emissão é assíncrona: salve o id da nota e atualize o status pelos webhooks nfse.invoice.authorized e nfse.invoice.rejected (verifique a assinatura) ou consultando GET /v1/invoices/:id.\n- Trate os erros documentados (validação, 409, 429 com Retry-After) e nunca registre em log documentos de clientes.\n- Escreva testes com HTTP simulado. Não chame o ambiente live.\n\nAo terminar, liste os arquivos que mudou e o que ainda preciso configurar (URL do webhook, variáveis de ambiente)."
        },
        {
          "kind": "heading",
          "level": 2,
          "body": "Em cada ferramenta"
        },
        {
          "kind": "list",
          "items": [
            "Claude Code, Codex e outros agentes de terminal: cole o prompt. Eles buscam o endereço sozinhos.",
            "Cursor: adicione `https://www.corvo.tech/llms-full.txt` como fonte de documentação (Settings → Indexing & Docs) e cite no chat, ou cole o prompt.",
            "VS Code, Windsurf e apps de chat: cole o prompt; se a ferramenta não abrir endereços, baixe o `llms-full.txt` e anexe o arquivo à conversa."
          ]
        },
        {
          "kind": "callout",
          "tone": "warn",
          "body": "Nunca cole uma chave `live` em um prompt ou chat. Mantenha a `corvo_test_...` em uma variável de ambiente, revise o código gerado antes de ir para produção (dados da empresa, código de serviço e regime tributário são você quem confirma) e só então troque a chave."
        },
        {
          "kind": "heading",
          "level": 2,
          "body": "Escrever o código ou operar direto"
        },
        {
          "kind": "text",
          "body": "Esta página é para um agente que escreve a integração no seu repositório. Se você quer que o agente emita e consulte notas por conta própria, numa conversa, conecte-o ao servidor MCP: veja Agentes de IA (MCP). Os dois podem ser usados juntos."
        }
      ]
    },
  },
};

// The retired credit-purchase reference is intentionally not published.
const { credits: _retiredCreditsPt, ...ptPages } = ptWithRetiredCredits.pages;
export const pt: DocsTree = {
  ...ptWithRetiredCredits,
  pages: ptPages as DocsTree["pages"],
};
