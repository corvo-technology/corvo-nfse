import type { BlogPost } from "../types";

export const post: BlogPost = {
  slug: "emitir-nota-fiscal-com-claude",
  title: "Emitir nota fiscal conversando com a inteligência artificial (Claude)",
  seoTitle: "Emitir nota fiscal conversando com a IA (Claude)",
  description:
    "Dá para pedir a nota fiscal de serviço numa conversa? Veja como conectar o Claude à Corvo, o que ele consegue fazer e como emitir com segurança.",
  publishedAt: "2026-11-10",
  updatedAt: "2026-11-10",
  cluster: "ia",
  keywords: [
    "emitir nota fiscal com IA",
    "emitir nota fiscal com Claude",
    "assistente de IA nota fiscal",
    "nota fiscal por conversa",
    "NFS-e com inteligência artificial",
    "MCP nota fiscal",
  ],
  answer:
    "Você conecta o Claude à Corvo uma vez, entra na sua conta e aprova o acesso. Depois, pede a nota em uma conversa, por exemplo: “emita uma nota de R$ 300 para este cliente”. O Claude mostra os dados, você confere e confirma. Comece pelo ambiente de teste, onde as notas não têm valor fiscal.",
  blocks: [
    {
      kind: "p",
      text: "A Corvo funciona com assistentes de inteligência artificial como o Claude: você escreve “emita a nota desse serviço”, o assistente prepara os dados e você confirma. A nota sai pela sua conta, com a sua empresa.",
    },
    { kind: "h2", text: "O que o assistente consegue fazer" },
    {
      kind: "ul",
      items: [
        "Encontrar as **empresas** da sua conta.",
        "**Emitir** uma nota de serviço.",
        "**Consultar** o status de uma nota e listar as suas notas.",
        "**Baixar o PDF** de uma nota autorizada.",
      ],
    },
    {
      kind: "p",
      text: "Ele só faz o que você permitir ao aprovar o acesso. Você pode liberar apenas a consulta, ou também a emissão.",
    },
    { kind: "h2", text: "Como conectar o Claude à Corvo" },
    {
      kind: "ol",
      items: [
        "No Claude Desktop, abra **Configurações** e depois **Conectores**.",
        "Clique em **Adicionar conector personalizado**, dê o nome **Corvo** e cole este endereço: `https://api.corvo.tech/mcp`.",
        "Clique em **Conectar**. O navegador abre na Corvo.",
        "Entre na sua conta, escolha o **workspace** e o **ambiente** e clique em **Permitir**.",
        "Volte ao Claude: as ferramentas da Corvo já estão disponíveis.",
      ],
    },
    {
      kind: "callout",
      tone: "warn",
      text: "Ao aprovar, você escolhe o ambiente: **teste** (notas sem valor fiscal) ou **produção** (notas reais, que usam as notas do seu plano). Cada conexão fica em um ambiente. Para trocar, reconecte. Comece sempre pelo teste.",
    },
    {
      kind: "p",
      text: "A Corvo documenta a conexão com Claude Code, Claude Desktop, Cursor, VS Code, Codex e Windsurf. Se algum não conectar, use o painel e avise o suporte. Quem programa encontra os detalhes técnicos na [página de agentes de IA da documentação](/pt/docs/mcp).",
    },
    { kind: "h2", text: "Um primeiro pedido seguro" },
    {
      kind: "p",
      text: "Conecte no ambiente de teste e escreva algo simples:",
    },
    {
      kind: "code",
      label: "Exemplo de pedido",
      language: "text",
      code: "Liste minhas empresas na Corvo e emita uma NFS-e de teste de R$ 100.",
    },
    {
      kind: "p",
      text: "A emissão não é instantânea: a nota começa **na fila** e depois é autorizada. Se pedir para consultar de novo em instantes, o Claude mostra o resultado.",
    },
    {
      kind: "p",
      text: "Depois do teste, você pode usar a conversa também para o dia a dia. Alguns pedidos que fazem sentido: “quais notas eu emiti este mês?”, “a nota do cliente tal já foi autorizada?” e “baixe o PDF da última nota”.",
    },
    { kind: "h2", text: "Como emitir com segurança" },
    {
      kind: "ul",
      items: [
        "Peça para conferir antes. Escreva: “antes de emitir, me mostre os dados da nota e espere eu confirmar”.",
        "**Confira você mesmo** os dados da empresa, o código do serviço e o regime tributário. O assistente não sabe isso melhor que você ou o seu contador.",
        "**Nunca envie o certificado digital nem senhas** na conversa. O certificado se envia só pelo painel da Corvo. Veja o [guia do certificado A1](/pt/blog/certificado-digital-a1-o-que-e-quando-precisa).",
        "**Use produção só para notas reais**, depois de testar.",
        "Dê só a permissão necessária. Se você só quer consultar, não libere a emissão.",
      ],
    },
    { kind: "h2", text: "Conversa, painel ou planilha?" },
    {
      kind: "table",
      head: ["Situação", "Melhor jeito"],
      rows: [
        ["Uma nota rápida, no meio do dia", "Conversa com o assistente ou painel"],
        ["Muitos clientes no fim do mês", "[Planilha](/pt/blog/emitir-varias-notas-fiscais-com-planilha)"],
        ["O mesmo cliente todo mês", "[Agenda](/pt/blog/nota-fiscal-todo-mes-agendada)"],
      ],
    },
  ],
  faq: [
    {
      q: "Dá para emitir nota fiscal conversando com uma IA?",
      a: "Sim. Você conecta um assistente como o Claude à Corvo, aprova o acesso e pede a nota em uma conversa. Ele mostra os dados, e você confere e confirma antes de emitir.",
    },
    {
      q: "Preciso enviar minha senha ou certificado para a IA?",
      a: "Não, e não deve. A conexão é feita por login e aprovação no navegador. O certificado digital se envia só pelo painel da Corvo.",
    },
    {
      q: "A IA pode emitir nota de verdade sem eu perceber?",
      a: "Só se você conectar no ambiente de produção e liberar a permissão de emitir. No ambiente de teste, as notas não têm valor fiscal. Peça sempre para ela mostrar os dados e esperar a sua confirmação.",
    },
    {
      q: "Quais assistentes funcionam com a Corvo?",
      a: "A Corvo documenta a conexão com Claude Code, Claude Desktop, Cursor, VS Code, Codex e Windsurf. Se algum não conectar, use o painel e avise o suporte.",
    },
    {
      q: "Preciso saber programar para conectar?",
      a: "Não. No Claude Desktop, a conexão é feita pelas configurações, colando o endereço da Corvo e aprovando o acesso no navegador.",
    },
  ],
  readNext: ["como-emitir-nota-fiscal-de-servico-nfse", "certificado-digital-a1-o-que-e-quando-precisa"],
};
