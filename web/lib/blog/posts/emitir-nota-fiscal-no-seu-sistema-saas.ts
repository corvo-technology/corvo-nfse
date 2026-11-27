import type { BlogPost } from "../types";

export const post: BlogPost = {
  slug: "emitir-nota-fiscal-no-seu-sistema-saas",
  title: "Como emitir nota fiscal dentro do seu sistema para os seus clientes",
  seoTitle: "Emitir nota fiscal no seu sistema para os clientes",
  description:
    "Seu sistema de gestão precisa emitir nota fiscal para os clientes? Veja como a Corvo atende várias empresas numa só conta e o que seu agente de IA já encontra pronto.",
  publishedAt: "2026-11-27",
  updatedAt: "2026-11-27",
  cluster: "ia",
  keywords: [
    "emitir nota fiscal no sistema",
    "API de nota fiscal para SaaS",
    "nota fiscal para vários clientes",
    "integrar nota fiscal em ERP",
    "NFS-e API multiempresa",
    "integrar nota fiscal com IA",
    "llms.txt nota fiscal",
  ],
  answer:
    "Na Corvo, cada estabelecimento do seu sistema vira uma empresa dentro da sua conta, com CNPJ e certificado digital próprios. Você cadastra e emite por empresa pela API, e recebe o resultado por aviso automático. Os planos mensais não limitam o número de empresas. Seu agente de IA lê a documentação completa em um arquivo só.",
  blocks: [
    {
      kind: "p",
      text: "Você está construindo um sistema para salões, clínicas, academias, restaurantes, escolas, oficinas ou escritórios de contabilidade. Ou um ERP de nicho, ou um marketplace de serviços. Em algum momento, os donos desses negócios pedem a mesma coisa: **emitir a nota fiscal sem sair do seu sistema.**",
    },
    {
      kind: "p",
      text: "O problema é que cada estabelecimento tem o seu CNPJ, o seu certificado digital e a sua prefeitura. Montar isso do zero, para cada cliente, vira um projeto à parte. Este texto mostra como dividir o trabalho com a Corvo e o que existe pronto, inclusive para quem constrói com um agente de IA, como Claude Code ou Cursor.",
    },
    { kind: "h2", text: "Como funciona: cada estabelecimento é uma empresa" },
    {
      kind: "p",
      text: "Você tem **uma conta na Corvo**, e dentro dela cadastra **uma empresa para cada estabelecimento** que usa o seu sistema. Cada empresa tem o seu CNPJ e o seu certificado digital A1. As notas de cada uma ficam separadas, e você vê quantas notas cada empresa usou.",
    },
    {
      kind: "table",
      head: ["Etapa", "Quem faz", "Como"],
      rows: [
        ["Cadastrar o estabelecimento", "Seu sistema", "A API cria a empresa a partir do CNPJ, e há uma consulta que traz os dados públicos do CNPJ"],
        ["Enviar o certificado A1", "Seu sistema, com o arquivo do cliente", "A API recebe o arquivo e a senha, e a empresa fica pronta para emitir"],
        ["Emitir a nota", "Seu sistema", "Cada pedido de emissão indica a empresa pelo CNPJ ou pelo id que a Corvo devolveu"],
        ["Saber o resultado", "A Corvo avisa o seu sistema", "Um aviso automático informa quando a nota foi autorizada ou recusada"],
      ],
    },
    {
      kind: "callout",
      tone: "accent",
      text: "A Corvo não tem contas separadas por cliente final. Quem tem conta é você, e cada estabelecimento é uma empresa dentro dela. Seus clientes não precisam criar login na Corvo.",
    },
    { kind: "h2", text: "Quem paga as notas e quantas empresas cabem" },
    {
      kind: "p",
      text: "Os créditos, o plano e os avisos automáticos pertencem à **sua conta**. Por isso, quem paga as notas é você, e cabe a você decidir se repassa o custo ao cliente na mensalidade do seu sistema. A Corvo não cobra o estabelecimento diretamente.",
    },
    {
      kind: "p",
      text: "Sobre o número de empresas: nos planos mensais, não há limite. Sem plano, a conta aceita uma empresa. Ao tentar cadastrar além disso, a API recusa o cadastro com o motivo `company_limit_exceeded`. Os planos e preços aparecem na página inicial da Corvo.",
    },
    { kind: "h2", text: "Em que cidades funciona" },
    {
      kind: "p",
      text: "A Corvo emite a NFS-e pelo padrão nacional, então atende empresas de qualquer município que use esse padrão, sem você montar uma integração por prefeitura. O cadastro aceita MEI e Simples Nacional. A NF-e e a NFC-e estão em **teste (homologação)**: as notas desse ambiente não têm valor fiscal, e a produção chega em breve. Veja [qual nota fiscal emitir](/pt/blog/nfse-nfe-ou-nfce-qual-nota-fiscal-emitir) em cada caso.",
    },
    { kind: "h2", text: "O que o seu agente de IA já encontra pronto" },
    {
      kind: "p",
      text: "Se você constrói com Claude Code, Cursor, Codex ou parecido, a documentação foi feita para ser lida por agentes. Não é obrigatório usar IA: tudo abaixo também serve a quem programa à mão.",
    },
    {
      kind: "table",
      head: ["O quê", "Onde fica", "Para quê"],
      rows: [
        ["Documentação em um arquivo só", "`https://www.corvo.tech/llms-full.txt`", "O agente lê tudo de uma vez e escreve a integração"],
        ["Índice curto", "`https://www.corvo.tech/llms.txt`", "O agente abre só as páginas de que precisa"],
        ["Contrato da API (OpenAPI)", "Link na [referência da API](/pt/api-docs)", "Gerar um cliente ou conferir o que o agente escreveu"],
        ["Servidor MCP", "`https://api.corvo.tech/mcp`", "O agente cadastra empresas, emite e consulta notas direto, numa conversa"],
        ["Bibliotecas oficiais", "Node.js, Python, Go, PHP, Ruby, Rust, Java, Elixir e .NET", "Chamar a API sem montar as requisições à mão"],
        ["Chave de teste", "Começa com `corvo_test_`", "Emitir notas sem valor fiscal, de graça"],
      ],
    },
    {
      kind: "p",
      text: "A API usa a chave no cabeçalho `X-API-Key`, e o prefixo da chave decide o ambiente: `corvo_test_` é teste, `corvo_live_` emite notas reais. Há uma [página só sobre IA na documentação](/pt/docs/llms) e outra sobre o [servidor MCP](/pt/docs/mcp).",
    },
    { kind: "h2", text: "Prompt para colar no seu agente" },
    {
      kind: "p",
      text: "Troque os trechos entre colchetes pela sua situação. O prompt pede só o ambiente de teste, porque a chave de produção nunca deve passar por um chat.",
    },
    {
      kind: "code",
      label: "Prompt para colar no seu agente",
      language: "text",
      code: "Leia https://www.corvo.tech/llms-full.txt (a documentação da API de NFS-e da Corvo) e integre a emissão de notas fiscais neste sistema de gestão. Cada estabelecimento cadastrado no meu sistema é uma empresa na Corvo.\n\nMinha stack: [linguagem e framework]. Os estabelecimentos ficam em [tabela ou modelo], com CNPJ, razão social, regime tributário e município.\n\nO que construir:\n1. Quando o estabelecimento ativar a nota fiscal, cadastre a empresa na Corvo (consulte os dados do CNPJ antes) e salve o id que a Corvo devolver junto do estabelecimento.\n2. Crie a tela de envio do certificado A1 (arquivo e senha) e envie à Corvo pela API. A senha nunca pode ser salva nem aparecer em log.\n3. Ao [fechar a comanda / concluir a venda], emita a NFS-e da empresa daquele estabelecimento, com os dados do cliente da venda.\n4. A emissão é assíncrona: salve o id da nota e atualize o status pelos avisos automáticos nfse.invoice.authorized e nfse.invoice.rejected (verifique a assinatura). Mostre o status e o link do PDF na tela da venda.\n\nRegras:\n- Use só o ambiente de teste. Leia a chave da variável de ambiente CORVO_API_KEY (começa com corvo_test_). Nunca escreva a chave no código, nos testes nem em commits.\n- Envie um Idempotency-Key montado com o id da venda, para que uma nova tentativa nunca crie uma segunda nota.\n- Trate os erros documentados, inclusive o de limite de empresas do plano.\n- Escreva testes com HTTP simulado. Não chame o ambiente de produção.\n\nNo fim, liste os arquivos que mudou e o que ainda preciso configurar.",
    },
    { kind: "h3", text: "Exemplo: emitir a nota de um estabelecimento" },
    {
      kind: "p",
      text: "É isto que o agente vai montar ao fechar uma venda. A empresa é indicada por `companyTaxId` (o CNPJ do estabelecimento) ou por `companyId`. Só `amount`, `competenceDate` e `service` são obrigatórios.",
    },
    {
      kind: "code",
      label: "Emitir uma NFS-e de teste para um estabelecimento",
      language: "bash",
      code: "curl -X POST https://api.corvo.tech/v1/invoices \\\n  -H \"X-API-Key: $CORVO_API_KEY\" \\\n  -H \"Content-Type: application/json\" \\\n  -H \"Idempotency-Key: venda_2087\" \\\n  -d '{\n    \"companyTaxId\": \"12345678000195\",\n    \"amount\": 180,\n    \"competenceDate\": \"2026-11-27\",\n    \"externalId\": \"venda_2087\",\n    \"service\": { \"description\": \"Corte e escova\" },\n    \"customer\": {\n      \"taxId\": \"12345678909\",\n      \"name\": \"Maria Souza\",\n      \"email\": \"maria@exemplo.com.br\"\n    },\n    \"email\": true\n  }'",
    },
    {
      kind: "p",
      text: "A resposta vem com o status `queued`: a nota entra na fila e depois é autorizada. Com `email` ligado, o cliente final recebe a nota no e-mail informado. O mesmo código atende todos os estabelecimentos. O que muda de um para outro é o `companyTaxId`.",
    },
    {
      kind: "callout",
      tone: "warn",
      text: "Nunca cole uma chave de produção (`corvo_live_`) em um prompt ou chat. Quanto ao certificado digital, o arquivo e a senha do cliente só devem passar pelo seu sistema até a Corvo, nunca por uma conversa com o agente.",
    },
    { kind: "h2", text: "Checklist: do cadastro do estabelecimento à produção" },
    {
      kind: "ol",
      items: [
        "**Crie a conta na Corvo.** A primeira nota é grátis, sem plano e sem cartão. O ambiente de teste é sempre grátis.",
        "**Gere uma chave de teste** no painel e deixe-a em uma variável de ambiente.",
        "**Cadastre um estabelecimento de teste** como empresa, com CNPJ, regime tributário e município.",
        "**Envie o [certificado digital A1](/pt/blog/certificado-digital-a1-o-que-e-quando-precisa)** do estabelecimento. Cada cliente seu precisa ter o dele.",
        "**Emita a primeira nota de teste** e confira o resultado.",
        "**Ligue os avisos automáticos** para o seu sistema saber quando a nota foi autorizada ou recusada.",
        "**Revise o código** que o agente escreveu. O código do serviço e o regime tributário de cada cliente, você confirma com o contador dele.",
        "**Crie a chave `corvo_live_`**, troque a variável de ambiente e libere a emissão real para o primeiro estabelecimento.",
      ],
    },
    {
      kind: "p",
      text: "Quem prefere não escrever código pode conectar a plataforma de pagamento à Corvo, e a nota sai a cada venda. Veja [nota fiscal automática para cada venda](/pt/blog/nota-fiscal-automatica-para-cada-venda-integracoes). Para operar pelo agente, sem código, veja [emitir nota fiscal com o Claude](/pt/blog/emitir-nota-fiscal-com-claude).",
    },
    { kind: "h2", text: "Código aberto e hospedagem própria" },
    {
      kind: "p",
      text: "A API, o processador de notas e o painel são públicos sob a licença AGPL-3.0 no [repositório da Corvo no GitHub](https://github.com/corvo-technology/corvo-nfse). Quem prefere pode hospedar por conta própria com Docker Compose, seguindo o arquivo SELF_HOSTING.md.",
    },
  ],
  faq: [
    {
      q: "Cada cliente meu precisa de conta na Corvo?",
      a: "Não. Você tem uma conta e cadastra cada estabelecimento como uma empresa dentro dela, pela API ou pelo painel. Os seus clientes não criam login na Corvo.",
    },
    {
      q: "Quem paga as notas, eu ou o meu cliente?",
      a: "Os créditos e o plano ficam na sua conta, então a cobrança da Corvo é com você. Se quiser repassar o custo, faça isso na mensalidade do seu sistema. A Corvo não cobra o estabelecimento diretamente.",
    },
    {
      q: "Quantas empresas posso cadastrar?",
      a: "Nos planos mensais, não há limite de empresas. Sem plano, a conta aceita uma empresa, e um novo cadastro é recusado com o motivo company_limit_exceeded.",
    },
    {
      q: "Funciona em qualquer cidade?",
      a: "A Corvo emite a NFS-e pelo padrão nacional, para MEI e Simples Nacional, sem integração por prefeitura. Vale confirmar com o contador do estabelecimento se o município dele já usa esse padrão.",
    },
    {
      q: "Como o meu cliente envia o certificado digital?",
      a: "Pela sua tela. O seu sistema recebe o arquivo A1 e a senha e os envia à Corvo pela API. Também dá para enviar pelo painel da Corvo. A senha não deve ser guardada nem ir para log.",
    },
    {
      q: "Meu sistema descobre sozinho que a nota foi autorizada?",
      a: "Sim. Você cadastra um aviso automático, e a Corvo avisa o seu sistema quando a nota é autorizada ou recusada. Também dá para consultar o status de uma nota quando quiser.",
    },
    {
      q: "Dá para testar sem pagar?",
      a: "Sim. O ambiente de teste é sempre grátis, e as notas dele não têm valor fiscal. A primeira nota em produção também é grátis, sem plano e sem cartão.",
    },
    {
      q: "A Corvo emite nota de produto para os meus clientes?",
      a: "A NFS-e, nota de serviço, emite de verdade. A NF-e e a NFC-e estão em teste, sem valor fiscal, e a produção chega em breve.",
    },
  ],
  readNext: [
    "emitir-nota-fiscal-com-claude",
    "nota-fiscal-automatica-para-cada-venda-integracoes",
    "certificado-digital-a1-o-que-e-quando-precisa",
  ],
};
