import type { BlogPost } from "../types";

export const post: BlogPost = {
  slug: "emitir-nfse-com-agente-de-ia-mcp",
  title: "Emitir NFS-e com agente de IA: Claude, Cursor e Codex via MCP",
  seoTitle: "Emitir NFS-e com agente de IA via MCP (Claude, Cursor)",
  description:
    "Como conectar Claude Code, Cursor, VS Code e Codex ao servidor MCP da Corvo por OAuth, quais ferramentas o agente recebe e como emitir NFS-e sem expor a chave.",
  publishedAt: "2026-11-10",
  updatedAt: "2026-11-10",
  cluster: "agentes",
  keywords: [
    "NFS-e MCP",
    "emitir nota fiscal com IA",
    "emitir NFS-e com Claude",
    "agente de IA nota fiscal",
    "MCP nota fiscal de serviço",
    "servidor MCP NFS-e",
  ],
  answer:
    "Adicione o servidor MCP `https://api.corvo.tech/mcp` ao seu agente (Claude Code, Cursor, VS Code, Codex ou Windsurf). O agente abre o navegador, você entra na Corvo, escolhe o workspace e o ambiente (teste ou produção) e aprova. Nenhuma chave de API é copiada, e o agente recebe ferramentas como `nfse_issue`, `nfse_calculate` e `nfse_query`.",
  blocks: [
    {
      kind: "p",
      text: "Pedir a um agente de IA “emite a nota desse cliente” só funciona se ele tiver uma forma segura de falar com o sistema fiscal. O **MCP** (Model Context Protocol) é o padrão que clientes como Claude Code e Cursor usam para chamar ferramentas externas. O servidor MCP da Corvo expõe a emissão e a consulta de NFS-e como ferramentas que o agente pode usar em nome de um usuário.",
    },
    {
      kind: "p",
      text: "A diferença para colar uma chave de API no prompt é grande: aqui a autorização é feita por OAuth, com escolha explícita do workspace, do ambiente e das permissões. Se você prefere integrar por código, o caminho é a [API REST](/pt/blog/api-de-nfse-emitir-nota-fiscal-de-servico); o MCP é para quando quem opera é um agente.",
    },
    { kind: "h2", text: "Como a conexão funciona" },
    {
      kind: "ol",
      items: [
        "Você adiciona o servidor ao agente, usando a URL `https://api.corvo.tech/mcp`.",
        "O agente abre o navegador na tela de aprovação da Corvo. Se você não estiver logado, entra primeiro.",
        "Você escolhe o **workspace**, o **ambiente** (`test` ou `live`) e clica em Permitir.",
        "De volta ao agente, as ferramentas da Corvo já estão disponíveis.",
      ],
    },
    {
      kind: "callout",
      tone: "warn",
      text: "Cada conexão fica em **um** ambiente. `test` emite notas sem valor fiscal; `live` emite notas reais e consome créditos. Para trocar, reconecte o agente. Comece sempre pelo teste.",
    },
    { kind: "h2", text: "Configurar no seu cliente" },
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
      code: `{
  "mcpServers": {
    "corvo": {
      "url": "https://api.corvo.tech/mcp"
    }
  }
}`,
    },
    {
      kind: "code",
      label: "VS Code (.vscode/mcp.json)",
      language: "json",
      code: `{
  "servers": {
    "corvo": {
      "type": "http",
      "url": "https://api.corvo.tech/mcp"
    }
  }
}`,
    },
    {
      kind: "p",
      text: "A [página de MCP da documentação](/pt/docs/mcp) traz também os formatos de Codex, Windsurf e Claude Desktop. Os comandos prontos para copiar aparecem ainda no painel, em Agentes de IA.",
    },
    {
      kind: "callout",
      tone: "accent",
      text: "A própria documentação avisa que os formatos de VS Code, Codex, Windsurf e Claude Desktop seguem a documentação pública de cada cliente e ainda não foram verificados com o OAuth da Corvo. Se algum não conectar, use o painel e avise o suporte.",
    },
    { kind: "h2", text: "O que o agente consegue fazer" },
    {
      kind: "table",
      head: ["Ferramenta", "Para quê", "Permissão"],
      rows: [
        ["`company_list`", "Listar as empresas emissoras do workspace.", "`nfse:read`"],
        ["`nfse_calculate`", "Calcular os tributos sem emitir.", "`nfse:read`"],
        ["`nfse_query`", "Consultar notas.", "`nfse:read`"],
        ["`nfse_issue`", "Emitir uma nota.", "`nfse:write`"],
        ["`nfse_issue_batch`", "Emitir de 1 a 50 notas numa chamada.", "`nfse:write`"],
      ],
    },
    {
      kind: "p",
      text: "A lista completa, com entradas e saídas de cada ferramenta, está na [documentação do MCP](/pt/docs/mcp). Um membro só consegue aprovar escopos que o próprio papel no workspace permite: `nfse:write` exige papel de admin ou developer.",
    },
    { kind: "h2", text: "Um primeiro teste seguro" },
    {
      kind: "p",
      text: "Conecte em `test` e peça algo pequeno e verificável:",
    },
    {
      kind: "code",
      label: "Prompt de teste",
      language: "text",
      code: "Liste minhas empresas na Corvo e emita uma NFS-e de teste de R$ 100.",
    },
    {
      kind: "p",
      text: "O agente chama `company_list`, escolhe a empresa e chama `nfse_issue`. A resposta traz `invoice_id`, `access_key` e `status`. Como a emissão é assíncrona, o status inicial é `queued`: peça ao agente para consultar a nota de novo com `nfse_query`. Entender por que isso acontece ajuda a escrever bons prompts; veja [Emissão assíncrona de NFS-e](/pt/blog/emissao-assincrona-nfse-idempotencia-webhooks).",
    },
    { kind: "h2", text: "Boas práticas de segurança" },
    {
      kind: "ul",
      items: [
        "**Nunca cole uma chave `live` em prompt ou chat.** Com OAuth você não precisa de chave nenhuma no agente.",
        "**Confirme o que o agente não sabe:** dados da empresa, código de serviço e regime tributário são responsabilidade sua. Revise o que ele montou antes de ir para produção.",
        "**Use `nfse_calculate` antes de `nfse_issue`** quando o valor ou a configuração fiscal forem novos.",
        "**Dê o menor escopo possível.** Para só consultar notas, `nfse:read` basta.",
        "**Mantenha o ambiente `test` no dia a dia** e conecte `live` só para a emissão real.",
      ],
    },
    { kind: "h2", text: "Se a conexão não funcionar" },
    {
      kind: "p",
      text: "A maior parte dos problemas de conexão vem de quatro causas, todas visíveis na tela de aprovação ou no próprio agente:",
    },
    {
      kind: "ul",
      items: [
        "**Você não estava logado.** A tela de aprovação pede o login primeiro e depois volta para a aprovação. Conclua o login e aprove de novo.",
        "**O workspace aparece desabilitado.** Seu papel nesse workspace não cobre o que o agente pediu. Peça a um admin para aprovar, ou conecte com um escopo menor (`nfse:read`).",
        "**O agente está no ambiente errado.** Cada conexão fica em `test` ou `live`. Para trocar de ambiente, reconecte o agente e escolha o outro na aprovação.",
        "**O formato de configuração do seu cliente não conectou.** Use os comandos prontos do painel, em Agentes de IA, e avise o suporte se o problema continuar.",
      ],
    },
    {
      kind: "p",
      text: "Se a emissão for aceita mas a nota não aparecer como autorizada de imediato, não é falha de conexão: a emissão é assíncrona e o status começa em `queued`. Consulte a nota de novo em alguns instantes.",
    },
    { kind: "h2", text: "Quando usar MCP e quando usar a API" },
    {
      kind: "table",
      head: ["Situação", "Melhor caminho"],
      rows: [
        ["Pessoa pedindo a nota em linguagem natural", "MCP"],
        ["Emissão automática disparada por pagamento ou cadastro", "API REST com webhooks"],
        ["Importar uma planilha com dezenas de linhas", "API de lote ou `nfse_issue_batch`"],
        ["Consultar notas e tirar dúvidas sobre status", "MCP"],
      ],
    },
  ],
  faq: [
    {
      q: "Preciso copiar uma chave de API para o agente de IA?",
      a: "Não. A conexão usa OAuth: o agente abre o navegador, você entra na Corvo, escolhe o workspace e aprova. Nenhuma chave de API é copiada para o agente.",
    },
    {
      q: "Quais agentes funcionam com o servidor MCP da Corvo?",
      a: "Claude Code, Cursor, VS Code, Codex, Windsurf e Claude Desktop. A documentação informa que alguns desses formatos ainda não foram verificados com o OAuth da Corvo; se algum não conectar, use o painel.",
    },
    {
      q: "O agente pode emitir nota real sem eu perceber?",
      a: "Só se a conexão tiver sido aprovada no ambiente `live`. Você escolhe o ambiente na tela de aprovação, e cada conexão fica em um só ambiente. Em `test`, as notas não têm valor fiscal.",
    },
    {
      q: "Como limito o que o agente pode fazer?",
      a: "Pelos escopos aprovados. `nfse:read` permite consultar, listar e baixar o PDF; `nfse:write` permite emitir. Cada membro só aprova escopos que o próprio papel no workspace permite.",
    },
    {
      q: "O MCP substitui a API REST?",
      a: "Não. O MCP é feito para um agente operar em nome de uma pessoa. Para emissão automática disparada pelo seu sistema, a API REST com webhooks é o caminho indicado.",
    },
  ],
  readNext: ["api-de-nfse-emitir-nota-fiscal-de-servico", "emissao-assincrona-nfse-idempotencia-webhooks"],
};
