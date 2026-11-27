import type { BlogPost } from "../types";

export const post: BlogPost = {
  slug: "vibecoder-nota-fiscal-saas-ia",
  title: "Vibecoder: seu SaaS precisa emitir nota fiscal? A Corvo já tem tudo para o seu agente de IA fazer a integração",
  seoTitle: "Nota fiscal no seu SaaS com IA: guia para vibecoders",
  description:
    "Criou um SaaS com Cursor, Claude Code ou Lovable e agora precisa emitir nota fiscal? Veja o que a Corvo entrega pronto para o seu agente de IA integrar.",
  publishedAt: "2026-11-27",
  updatedAt: "2026-11-27",
  cluster: "ia",
  keywords: [
    "nota fiscal SaaS",
    "emitir nota fiscal vibecoding",
    "integrar nota fiscal com IA",
    "API de nota fiscal para desenvolvedores",
    "NFS-e API Cursor Claude Code",
    "llms.txt nota fiscal",
    "MCP nota fiscal",
  ],
  answer:
    "Entregue ao seu agente de IA o arquivo https://www.corvo.tech/llms-full.txt, que reúne toda a documentação da Corvo. Com ele, o agente escreve a emissão de NFS-e no seu app, usando uma chave de teste grátis. Se preferir não programar, conecte a sua plataforma de pagamento e a nota sai sozinha a cada venda.",
  blocks: [
    {
      kind: "p",
      text: "Você montou um SaaS com Cursor, Claude Code, Lovable, Bolt, v0 ou Replit. Os primeiros clientes pagaram. Aí aparece a pergunta: **e a nota fiscal?** Emitir nota exige certificado digital, regras de cada prefeitura e um sistema do governo que muda. Não é o tipo de coisa que se resolve com um prompt solto.",
    },
    {
      kind: "p",
      text: "A parte boa: a Corvo já publica o que um agente de IA precisa para fazer a integração por você. Este texto mostra o que existe, o que copiar e o que você ainda decide sozinho.",
    },
    { kind: "h2", text: "O que a Corvo entrega pronto para o seu agente" },
    {
      kind: "table",
      head: ["O quê", "Onde fica", "Para quê"],
      rows: [
        ["Documentação em um arquivo só", "`https://www.corvo.tech/llms-full.txt`", "O agente lê tudo de uma vez e escreve a integração"],
        ["Índice curto", "`https://www.corvo.tech/llms.txt`", "O agente abre só as páginas de que precisa"],
        ["Contrato da API (OpenAPI)", "Link na [referência da API](/pt/api-docs)", "Gerar um cliente ou conferir o que o agente escreveu"],
        ["Servidor MCP", "`https://api.corvo.tech/mcp`", "O agente emite e consulta notas direto, numa conversa"],
        ["Bibliotecas oficiais", "Node.js, Python, Go, PHP, Ruby, Rust, Java, Elixir e .NET", "Chamar a API sem montar as requisições à mão"],
        ["Chave de teste", "Começa com `corvo_test_`", "Emitir notas sem valor fiscal, de graça"],
      ],
    },
    {
      kind: "p",
      text: "Tudo isso segue o mesmo desenho. A API usa a chave no cabeçalho `X-API-Key`, e o prefixo da chave decide o ambiente: `corvo_test_` é teste, `corvo_live_` emite notas reais.",
    },
    { kind: "h2", text: "Caminho 1: seu agente escreve a integração" },
    {
      kind: "p",
      text: "Este é o caminho para quem quer a emissão dentro do próprio app, no ponto em que o pedido vira nota. A Corvo mantém uma [página só sobre isso na documentação](/pt/docs/llms). O prompt abaixo parte dela. Troque o trecho entre colchetes pela sua situação e cole no agente.",
    },
    {
      kind: "code",
      label: "Prompt para colar no seu agente",
      language: "text",
      code: "Leia https://www.corvo.tech/llms-full.txt (a documentação da API de NFS-e da Corvo) e integre a emissão de notas neste projeto.\n\nMinha stack: [linguagem e framework]. Quando o Stripe confirmar o pagamento de uma assinatura, emita a nota de serviço para o cliente. Pegue o CPF ou CNPJ, o nome e o e-mail dele de [onde ficam no meu banco].\n\nRegras:\n- Use só o ambiente de teste. Leia a chave da variável de ambiente CORVO_API_KEY (começa com corvo_test_). Nunca escreva a chave no código, nos testes nem em commits.\n- Cadastre a empresa emissora uma vez e guarde o id.\n- Emita com POST /v1/invoices e envie um Idempotency-Key montado com o id do pagamento, para que uma nova tentativa nunca crie uma segunda nota.\n- A emissão é assíncrona: salve o id da nota e atualize o status pelos webhooks nfse.invoice.authorized e nfse.invoice.rejected (verifique a assinatura) ou consultando GET /v1/invoices/:id.\n- Trate os erros documentados e nunca registre em log o documento dos clientes.\n- Escreva testes com HTTP simulado. Não chame o ambiente de produção.\n\nNo fim, liste os arquivos que mudou e o que ainda preciso configurar.",
    },
    {
      kind: "p",
      text: "No Cursor, você também pode adicionar o `llms-full.txt` como fonte de documentação e citar no chat. Em ferramentas que não abrem endereços, baixe o arquivo e anexe à conversa.",
    },
    { kind: "h3", text: "Como é uma nota de serviço" },
    {
      kind: "p",
      text: "O pedido abaixo é o que o agente vai montar. Só `amount`, `competenceDate` e `service` são obrigatórios. A empresa é indicada por `companyTaxId` (o CNPJ) ou `companyId`.",
    },
    {
      kind: "code",
      label: "Emitir uma NFS-e de teste",
      language: "bash",
      code: "curl -X POST https://api.corvo.tech/v1/invoices \\\n  -H \"X-API-Key: $CORVO_API_KEY\" \\\n  -H \"Content-Type: application/json\" \\\n  -H \"Idempotency-Key: pagamento_1042\" \\\n  -d '{\n    \"companyTaxId\": \"12345678000195\",\n    \"amount\": 150,\n    \"competenceDate\": \"2026-11-27\",\n    \"externalId\": \"pagamento_1042\",\n    \"service\": { \"description\": \"Assinatura mensal do plano Pro\" },\n    \"customer\": {\n      \"taxId\": \"12345678909\",\n      \"name\": \"Maria Souza\",\n      \"email\": \"maria@exemplo.com.br\"\n    },\n    \"email\": true\n  }'",
    },
    {
      kind: "p",
      text: "A resposta vem com o status `queued`: a nota entra na fila e depois é autorizada. Por isso o prompt pede para o agente guardar o id e acompanhar o resultado. Com `email` ligado, o cliente recebe a nota no e-mail informado.",
    },
    { kind: "h2", text: "Caminho 2: sem código, pela plataforma de pagamento" },
    {
      kind: "p",
      text: "Nem todo SaaS precisa escrever essa parte. Se você já cobra por Stripe, Mercado Pago, Asaas, Pagar.me, Woovi, AbacatePay ou PushinPay, pode conectar a plataforma à Corvo, colando um endereço de aviso nela. **Pagou, a Corvo emite.** Quem vende por Hotmart, Kiwify, Eduzz ou Monetizze também tem conexão pronta.",
    },
    {
      kind: "p",
      text: "Para decidir: se a sua cobrança passa por uma dessas plataformas, comece por aqui, porque você não mantém código nenhum. Se a cobrança é sua, ou a nota depende de regras do seu produto, use o caminho 1. Veja o passo a passo em [nota fiscal automática para cada venda](/pt/blog/nota-fiscal-automatica-para-cada-venda-integracoes) e a [página de integrações](/pt/integrations).",
    },
    { kind: "h2", text: "Caminho 3: o agente opera a Corvo por você" },
    {
      kind: "p",
      text: "O MCP é um jeito de dar ferramentas ao agente. Em vez de escrever código, ele cadastra a empresa, emite a nota e consulta o status, direto numa conversa. Conecte com um comando ou com o arquivo de configuração da sua ferramenta:",
    },
    {
      kind: "code",
      label: "Claude Code",
      language: "bash",
      code: "claude mcp add --transport http corvo https://api.corvo.tech/mcp",
    },
    {
      kind: "code",
      label: "Cursor (.cursor/mcp.json)",
      language: "json",
      code: "{\n  \"mcpServers\": {\n    \"corvo\": {\n      \"url\": \"https://api.corvo.tech/mcp\"\n    }\n  }\n}",
    },
    {
      kind: "p",
      text: "A conexão pede login no navegador. Na tela de aprovação, você escolhe o workspace e o ambiente, teste ou produção. A Corvo documenta a conexão com Claude Code, Cursor, Codex, VS Code, Windsurf e Claude Desktop. Veja os detalhes em [emitir nota fiscal com o Claude](/pt/blog/emitir-nota-fiscal-com-claude) e na [documentação do MCP](/pt/docs/mcp).",
    },
    {
      kind: "callout",
      tone: "warn",
      text: "Nunca cole uma chave de produção (`corvo_live_`) em um prompt ou chat, e nunca envie o certificado digital nem a senha dele na conversa. O certificado vai só pelo painel da Corvo.",
    },
    { kind: "h2", text: "Passo a passo: da chave de teste à produção" },
    {
      kind: "ol",
      items: [
        "**Crie a conta.** A primeira nota é grátis, sem plano e sem cartão. O ambiente de teste é sempre grátis.",
        "**Gere uma chave de teste** no painel. Ela começa com `corvo_test_` e as notas dela não têm valor fiscal.",
        "**Cadastre a empresa emissora** com CNPJ, regime tributário e município. A Corvo atende MEI e Simples Nacional.",
        "**Emita a primeira nota de teste**, pelo seu agente ou pelo MCP, e confira o resultado.",
        "**Configure o aviso automático** para o seu app saber quando a nota foi autorizada ou recusada.",
        "**Envie o [certificado digital A1](/pt/blog/certificado-digital-a1-o-que-e-quando-precisa)** da empresa pelo painel. Sem ele, não há nota de verdade.",
        "**Revise o código** que o agente escreveu. O código do serviço e o regime tributário são você, com o seu contador, quem confirma.",
        "**Crie a chave `corvo_live_`**, troque a variável de ambiente e emita a primeira nota real.",
      ],
    },
    { kind: "h2", text: "E nota de produto, a NF-e e a NFC-e?" },
    {
      kind: "p",
      text: "A Corvo emite **NFS-e**, a nota de serviço, de verdade. A NF-e e a NFC-e estão em **teste (homologação)**: as notas emitidas nesse ambiente não têm valor fiscal, e a produção chega em breve. Se o seu SaaS vende produto físico, veja [qual nota fiscal emitir](/pt/blog/nfse-nfe-ou-nfce-qual-nota-fiscal-emitir).",
    },
    { kind: "h2", text: "Código aberto e hospedagem própria" },
    {
      kind: "p",
      text: "A API, o processador de notas e o painel são públicos sob a licença AGPL-3.0 no [repositório da Corvo no GitHub](https://github.com/corvo-technology/corvo-nfse). Quem prefere pode hospedar por conta própria com Docker Compose. As instruções ficam no arquivo SELF_HOSTING.md do repositório.",
    },
  ],
  faq: [
    {
      q: "Como faço o meu agente de IA integrar a nota fiscal no meu SaaS?",
      a: "Dê a ele o endereço https://www.corvo.tech/llms-full.txt, que reúne a documentação da Corvo, e peça a integração. Use uma chave de teste, guardada em variável de ambiente, e revise o código antes de ir para produção.",
    },
    {
      q: "Preciso saber programar para emitir nota fiscal no meu SaaS?",
      a: "Não necessariamente. Se você cobra por Stripe, Mercado Pago, Asaas ou outra plataforma aceita, pode conectá-la à Corvo e a nota sai sozinha a cada pagamento. Também dá para conectar um agente de IA pelo MCP e pedir as notas numa conversa.",
    },
    {
      q: "Dá para testar sem pagar?",
      a: "Sim. O ambiente de teste é sempre grátis, e as notas dele não têm valor fiscal. A primeira nota em produção também é grátis, sem plano e sem cartão.",
    },
    {
      q: "Quais linguagens têm biblioteca oficial?",
      a: "Node.js, Python, Go, PHP, Ruby, Rust, Java, Elixir e .NET. Todas fazem as mesmas operações e leem a chave da variável CORVO_API_KEY.",
    },
    {
      q: "Meu agente pode emitir uma nota de verdade sem eu perceber?",
      a: "Só se você conectar no ambiente de produção e liberar a permissão de emitir. Comece pelo teste e peça ao agente para mostrar os dados e esperar a sua confirmação antes de emitir.",
    },
    {
      q: "A Corvo emite nota de produto para o meu SaaS?",
      a: "A nota de serviço (NFS-e) emite de verdade. A NF-e e a NFC-e estão em teste, sem valor fiscal, e a produção chega em breve. Vale conferir com o seu contador qual nota o seu caso exige.",
    },
    {
      q: "Posso hospedar a Corvo por conta própria?",
      a: "Sim. O código é aberto sob a AGPL-3.0 e pode ser hospedado com Docker Compose, seguindo o SELF_HOSTING.md do repositório.",
    },
  ],
  readNext: [
    "emitir-nota-fiscal-com-claude",
    "nota-fiscal-automatica-para-cada-venda-integracoes",
    "certificado-digital-a1-o-que-e-quando-precisa",
  ],
};
