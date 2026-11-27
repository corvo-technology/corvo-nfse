import type { BlogPost } from "../types";

export const post: BlogPost = {
  slug: "reembolso-chargeback-nota-fiscal-cancelar",
  title: "Reembolso e chargeback: o que acontece com a nota fiscal, e quando cancelar",
  seoTitle: "Reembolso e chargeback: cancelar a nota fiscal?",
  description:
    "Cliente pediu reembolso ou abriu chargeback? Veja o que acontece com a nota fiscal na Corvo, quando ela cancela sozinha e quando a decisão fica com você.",
  publishedAt: "2026-11-27",
  updatedAt: "2026-11-27",
  cluster: "regras",
  keywords: [
    "reembolso nota fiscal",
    "chargeback nota fiscal",
    "cancelar nota fiscal reembolso",
    "devolução de venda nota fiscal",
    "estorno nota fiscal",
    "cancelamento automático nota fiscal",
  ],
  answer:
    "Na Corvo, o reembolso cancela a nota fiscal sozinho, mas só se você ligar essa regra na conexão. O chargeback e a disputa, na maioria das plataformas, apenas deixam a venda marcada para você decidir. Na Hotmart e na Eduzz, o chargeback conta como reembolso. Reembolso parcial é ignorado em algumas plataformas.",
  blocks: [
    {
      kind: "p",
      text: "Você emitiu a nota, e o cliente pediu o dinheiro de volta. A nota some? Não sozinha. Este texto explica o que a Corvo faz em cada caso, para você não ser pego de surpresa.",
    },
    {
      kind: "callout",
      tone: "warn",
      text: "Este texto explica o comportamento da Corvo. Se uma nota deve ser cancelada, e até quando, é uma questão fiscal que varia conforme o município e o estado. **Consulte o seu contador.**",
    },
    { kind: "h2", text: "Reembolso: cancela a nota, se você ligar a regra" },
    {
      kind: "p",
      text: "Quando a plataforma avisa que uma venda foi reembolsada, a Corvo cancela a nota **se a regra de cancelamento automático estiver ligada** naquela conexão. Ela é uma regra que você liga em cada conexão. Com a regra desligada, a nota continua valendo, e o cancelamento fica com você.",
    },
    {
      kind: "p",
      text: "Isso vale para Mercado Pago, Stripe, Asaas, Pagar.me, AbacatePay, Hotmart, Kiwify e Eduzz. Na Woovi, vale a devolução total do Pix. Na Monetizze, vale a venda devolvida. Na PushinPay, vale a cobrança cancelada depois de paga.",
    },
    { kind: "h2", text: "Chargeback e disputa: a decisão é sua" },
    {
      kind: "p",
      text: "Chargeback é quando o cliente contesta a compra com o banco ou o cartão. Enquanto a contestação não termina, você ainda não sabe se vai perder o dinheiro. Por isso, na maioria das plataformas, a Corvo **só marca a venda** e deixa a decisão com você.",
    },
    {
      kind: "table",
      head: ["Plataforma", "Reembolso", "Chargeback ou disputa"],
      rows: [
        ["Mercado Pago", "Cancela a nota", "A venda fica marcada para você decidir"],
        ["Stripe", "Cancela a nota", "A venda fica marcada para você decidir"],
        ["Asaas", "Cancela a nota", "Pedido de chargeback: a venda fica marcada"],
        ["Pagar.me", "Cancela a nota (reembolso parcial é ignorado)", "A venda fica marcada"],
        ["Woovi", "Devolução total do Pix cancela a nota (parcial é ignorada)", "Não se aplica"],
        ["AbacatePay", "Cancela a nota", "A venda fica marcada para você decidir"],
        ["PushinPay", "Cobrança cancelada depois de paga cancela a nota", "Não se aplica"],
        ["Hotmart", "Cancela a nota (reembolso parcial é ignorado)", "Chargeback conta como reembolso. Protesto deixa a venda marcada"],
        ["Kiwify", "Cancela a nota", "A venda fica marcada para você decidir"],
        ["Eduzz", "Cancela a nota", "Chargeback conta como reembolso"],
        ["Monetizze", "Venda devolvida cancela a nota", "Não se aplica"],
      ],
    },
    {
      kind: "p",
      text: "Os casos da Hotmart e da Eduzz são os únicos em que o chargeback cancela a nota como se fosse um reembolso, **se a regra estiver ligada**.",
    },
    { kind: "h2", text: "Reembolso parcial" },
    {
      kind: "p",
      text: "Se o cliente recebeu só uma parte do dinheiro de volta, a Corvo **não cancela** a nota na Woovi, na Hotmart e no Pagar.me: o aviso é ignorado. A nota continua com o valor original. Se o contador orientar emitir uma nota nova ou ajustar o valor, isso é feito por você.",
    },
    { kind: "h2", text: "Cancelar a nota ou deixar valer?" },
    {
      kind: "p",
      text: "Cancelar uma nota é o jeito de dizer ao governo que a venda não aconteceu. Isso faz sentido quando o dinheiro voltou para o cliente. O que não é igual para todo mundo: o **prazo** para cancelar, a necessidade de **justificativa** e o que fazer depois do prazo. Essas regras variam conforme o município. Pergunte ao contador, e ligue a regra automática só depois de entender como ela funciona no seu caso.",
    },
    {
      kind: "ul",
      items: [
        "**Reembolso pago:** o comum é cancelar a nota. Confirme o prazo do seu município.",
        "**Chargeback em andamento:** aguarde o resultado antes de decidir. A venda marcada na Corvo serve de lembrete.",
        "**Chargeback perdido:** o dinheiro saiu da sua conta. Converse com o contador sobre cancelar a nota.",
        "**Chargeback ganho:** o dinheiro ficou com você. Na dúvida, confirme com o contador antes de cancelar.",
      ],
    },
    { kind: "h2", text: "Como ligar ou desligar a regra" },
    {
      kind: "p",
      text: "A regra fica nas configurações de cada conexão, na [página de integrações](/pt/integrations). Você pode ter uma conexão com cancelamento automático e outra sem.",
    },
    {
      kind: "p",
      text: "Para infoprodutos, que têm prazo de garantia e muitos reembolsos, leia [nota fiscal para infoprodutor](/pt/blog/nota-fiscal-infoprodutor-hotmart-kiwify-eduzz-monetizze). Para conectar as plataformas de pagamento, veja [nota fiscal automática para cada venda](/pt/blog/nota-fiscal-automatica-para-cada-venda-integracoes).",
    },
    { kind: "h2", text: "E nas notas de produto?" },
    {
      kind: "p",
      text: "A NF-e e a NFC-e, que estão em teste na Corvo, também se cancelam com uma justificativa. Na NF-e, a SEFAZ tem um prazo para aceitar o cancelamento, e a NFC-e não tem carta de correção. Veja [o que é NF-e](/pt/blog/o-que-e-nf-e-como-emitir-nota-fiscal-de-produto) e [o que é NFC-e](/pt/blog/o-que-e-nfc-e-cupom-fiscal-eletronico).",
    },
  ],
  faq: [
    {
      q: "O reembolso cancela a nota fiscal automaticamente?",
      a: "Na Corvo, só se você ligar a regra de cancelamento automático da conexão. Com a regra desligada, a nota continua valendo.",
    },
    {
      q: "O chargeback cancela a nota?",
      a: "Na maioria das plataformas, não: a venda só fica marcada para você decidir. Na Hotmart e na Eduzz, o chargeback conta como reembolso e cancela a nota, se a regra estiver ligada.",
    },
    {
      q: "E se o reembolso for parcial?",
      a: "No Pagar.me, na Woovi e na Hotmart, o reembolso parcial é ignorado e a nota não é cancelada. Fale com o contador sobre como tratar a diferença.",
    },
    {
      q: "Preciso cancelar a nota quando devolvo o dinheiro?",
      a: "Em geral, é o caminho comum, mas prazos e regras variam conforme o município. Consulte o seu contador ou a prefeitura.",
    },
    {
      q: "Posso cancelar a nota por conta própria, sem a regra automática?",
      a: "Pode. O cancelamento manual existe no painel e na API, com a justificativa. A regra automática só poupa o trabalho de fazer isso a cada reembolso.",
    },
  ],
  readNext: [
    "nota-fiscal-automatica-para-cada-venda-integracoes",
    "nota-fiscal-infoprodutor-hotmart-kiwify-eduzz-monetizze",
    "como-emitir-nota-fiscal-de-servico-nfse",
  ],
};
