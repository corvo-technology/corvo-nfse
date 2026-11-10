import type { BlogPost } from "../types";

export const post: BlogPost = {
  slug: "api-de-nfse-emitir-nota-fiscal-de-servico",
  title: "API de NFS-e: como emitir nota fiscal de serviço por API (MEI e Simples Nacional)",
  seoTitle: "API de NFS-e: emitir nota fiscal de serviço por API",
  description:
    "Como emitir NFS-e por API REST: cadastro da empresa, chave de teste, POST /v1/invoices, status assíncrono e a passagem para produção com certificado A1.",
  publishedAt: "2026-11-10",
  updatedAt: "2026-11-10",
  cluster: "api",
  keywords: [
    "API NFS-e",
    "emitir NFS-e por API",
    "API de notas fiscais",
    "NFS-e nacional",
    "NFS-e MEI",
    "NFS-e Simples Nacional",
  ],
  answer:
    "Emitir NFS-e por API é cadastrar a empresa emissora uma vez e, a cada serviço prestado, enviar um `POST /v1/invoices` com o valor e a descrição. A API responde `202` com a nota em `queued`; o resultado chega por webhook ou por `GET /v1/invoices/:id`. Em teste não é preciso certificado; em produção a empresa envia o certificado A1.",
  blocks: [
    {
      kind: "p",
      text: "Quem constrói um SaaS, um ERP ou um sistema de agendamento mais cedo ou mais tarde recebe o mesmo pedido: “o cliente pagou, emite a nota”. Fazer isso na mão, no portal, funciona para a primeira empresa. Com dezenas de empresas, ou com o pagamento disparando a nota automaticamente, o portal deixa de ser opção e a conversa passa a ser **integração**.",
    },
    {
      kind: "p",
      text: "Este guia mostra o caminho mais curto do cadastro à primeira nota emitida pela Corvo, o que a API faz por você e onde ficam os limites. Os nomes de campos e rotas seguem a [documentação da API](/pt/docs/invoices).",
    },
    { kind: "h2", text: "O que é uma API de NFS-e" },
    {
      kind: "p",
      text: "A NFS-e é a nota fiscal de serviço eletrônica. No padrão nacional, o prestador transmite uma DPS (Declaração de Prestação de Serviços) assinada com o certificado digital da empresa e recebe de volta a nota autorizada, com XML e PDF. Uma API de NFS-e esconde essa transmissão atrás de uma chamada HTTP comum: você manda os dados do serviço em JSON e a plataforma monta a DPS, assina, envia, acompanha o retorno e entrega os documentos.",
    },
    {
      kind: "p",
      text: "Para o seu código, o ganho é não precisar aprender o protocolo fiscal nem manter a assinatura e as regras de cada situação tributária. Para a empresa emissora, o ganho é que a nota sai sem que alguém abra o portal.",
    },
    { kind: "h2", text: "O que a Corvo cobre e o que não cobre" },
    {
      kind: "ul",
      items: [
        "**Cobre:** NFS-e (serviços) no padrão nacional, para empresas **MEI** e do **Simples Nacional**.",
        "**Cobre:** cálculo dos tributos antes de emitir, várias empresas emissoras na mesma conta, webhooks, XML e PDF, SDKs oficiais e um servidor MCP para agentes de IA.",
        "**Não cobre:** NF-e e NFC-e (notas de produtos e de varejo) e empresas fora do MEI e do Simples Nacional. Outro regime retorna `422` com `ERROR_TAX_REGIME_NOT_SUPPORTED`.",
        "**Não faz:** a guia do DAS. Uma ME/EPP do Simples informa a própria alíquota efetiva (`simplesRate`) ao cadastrar a empresa; um MEI não informa alíquota.",
      ],
    },
    { kind: "h2", text: "Passo a passo: da conta à primeira nota" },
    {
      kind: "ol",
      items: [
        "**Crie a conta** em [corvo.tech](/pt/start). Não pede cartão de crédito.",
        "**Gere uma chave de teste** no painel. Ela começa com `corvo_test_`; notas emitidas com ela não têm valor fiscal.",
        "**Cadastre a empresa emissora** com `POST /v1/companies`. São obrigatórios `legalName`, `taxId`, `taxRegime` e `municipalityCode` (código IBGE de 7 dígitos).",
        "**Emita a nota** com `POST /v1/invoices`, enviando um `Idempotency-Key`.",
        "**Acompanhe o resultado** por `GET /v1/invoices/:id` ou pelo webhook `nfse.invoice.authorized` (ou `nfse.invoice.rejected`).",
      ],
    },
    {
      kind: "code",
      label: "Cadastrar a empresa e emitir a nota",
      language: "bash",
      code: `export BASE_URL='https://api.corvo.tech/v1'
export CORVO_API_KEY='corvo_test_sua_chave'

# Cadastrar a empresa emissora
curl -X POST "$BASE_URL/companies" \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -H 'Content-Type: application/json' \\
  -d '{"legalName":"Empresa Exemplo Ltda","taxId":"11222333000181","taxRegime":"MEI","municipalityCode":"3550308"}'

# Emitir a nota (responde 202, status queued)
curl -X POST "$BASE_URL/invoices" \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -H 'Content-Type: application/json' \\
  -H 'Idempotency-Key: pedido_123_emissao' \\
  -d '{"companyTaxId":"11222333000181","amount":100,"service":{"description":"Consultoria"}}'`,
    },
    {
      kind: "p",
      text: "A autenticação é sempre o header `X-API-Key`. A chave decide o ambiente: `corvo_test_` para teste e `corvo_live_` para produção. Se preferir não montar as chamadas à mão, há [SDKs oficiais](/pt/docs/sdks) em nove linguagens com o mesmo contrato.",
    },
    { kind: "h2", text: "Por que a resposta é 202 e não a nota pronta" },
    {
      kind: "p",
      text: "A emissão é **assíncrona**. A API aceita o pedido, responde `202` com a nota em `queued` e a transmissão acontece em segundo plano. Isso protege o seu sistema de ficar preso esperando a Sefin e evita que um timeout vire nota duplicada. O desenho correto é guardar o `data.id` da resposta e esperar o webhook, em vez de manter a requisição aberta.",
    },
    {
      kind: "p",
      text: "Os detalhes de status, repetição segura e verificação de assinatura estão em [Emissão assíncrona de NFS-e: idempotência, webhooks e status](/pt/blog/emissao-assincrona-nfse-idempotencia-webhooks).",
    },
    { kind: "h2", text: "Conferir os tributos antes de emitir" },
    {
      kind: "p",
      text: "`POST /v1/invoices/calculate` recebe o mesmo corpo da emissão e devolve os tributos **sem emitir**: não grava nota, não consome crédito, não reserva número de DPS e não chama a Sefin. Serve para validar a configuração fiscal da empresa e para mostrar o valor líquido ao cliente antes de confirmar. O resultado é uma estimativa, não uma autorização.",
    },
    { kind: "h2", text: "Passando para produção" },
    {
      kind: "ol",
      items: [
        "Crie uma chave `corvo_live_`.",
        "Envie o **certificado A1** da empresa pelo painel ou por `POST /v1/companies/:companyId/certificates`.",
        "Confira se a empresa está pronta para produção. O ambiente `live` exige essa prontidão antes de aceitar a emissão.",
        "Troque a chave no seu sistema. Em produção, cada nota aceita reserva um crédito do plano.",
      ],
    },
    {
      kind: "callout",
      tone: "warn",
      text: "Nunca coloque a chave `corvo_live_` em código versionado, em prompt ou em chat. Use variável de ambiente e rotacione a chave se ela vazar.",
    },
    { kind: "h2", text: "Checklist antes de ir ao ar" },
    {
      kind: "ul",
      items: [
        "Toda emissão envia um `Idempotency-Key` estável por operação de negócio (por exemplo, o id do pedido).",
        "O sistema trata `202` como “recebido”, não como “autorizado”.",
        "Há um endpoint de webhook respondendo `2xx` e validando `X-Corvo-Signature`.",
        "Erros `429` e `503` fazem nova tentativa com espera, respeitando `Retry-After`.",
        "O [checklist de integração](/pt/docs/integration-checklist) da documentação foi percorrido uma vez.",
      ],
    },
  ],
  faq: [
    {
      q: "Preciso de certificado digital para testar a API de NFS-e?",
      a: "Não. No ambiente de teste, com a chave `corvo_test_`, não é preciso certificado e as notas não têm valor fiscal. O certificado A1 da empresa só é necessário para emitir em produção.",
    },
    {
      q: "A API emite nota para empresa fora do MEI e do Simples Nacional?",
      a: "Não. A Corvo atende só MEI e Simples Nacional. Outro regime retorna `422` com `ERROR_TAX_REGIME_NOT_SUPPORTED`. A Corvo também cobre apenas NFS-e, não NF-e nem NFC-e.",
    },
    {
      q: "Por que a emissão responde 202 e não devolve a nota autorizada?",
      a: "Porque a transmissão para a Sefin é assíncrona. A resposta `202` traz a nota em `queued`; o resultado chega pelo webhook `nfse.invoice.authorized` ou `nfse.invoice.rejected`, ou por `GET /v1/invoices/:id`.",
    },
    {
      q: "Dá para calcular os tributos sem gastar crédito?",
      a: "Sim. `POST /v1/invoices/calculate` calcula sem emitir, sem consumir crédito e sem chamar a Sefin. O resultado é uma estimativa pré-emissão, não uma autorização.",
    },
    {
      q: "Uma conta pode ter várias empresas emissoras?",
      a: "Sim. Uma conta guarda várias empresas, cada uma com o próprio certificado. Na emissão, você indica a empresa pelo CNPJ em `companyTaxId`.",
    },
  ],
  readNext: ["emissao-assincrona-nfse-idempotencia-webhooks", "emitir-nfse-com-agente-de-ia-mcp"],
};
