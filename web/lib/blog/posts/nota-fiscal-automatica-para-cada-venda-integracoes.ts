import type { BlogPost } from "../types";

export const post: BlogPost = {
  slug: "nota-fiscal-automatica-para-cada-venda-integracoes",
  title: "Nota fiscal automática para cada venda: como conectar Mercado Pago, Stripe, Asaas, Pagar.me e Pix à Corvo",
  seoTitle: "Nota fiscal automática: Mercado Pago, Stripe, Asaas e Pix",
  description:
    "Conecte Mercado Pago, Stripe, Asaas, Pagar.me, Woovi, AbacatePay ou PushinPay à Corvo e a nota fiscal sai sozinha a cada venda paga. Veja como funciona.",
  publishedAt: "2026-11-27",
  updatedAt: "2026-11-27",
  cluster: "rotina",
  keywords: [
    "nota fiscal automática",
    "emitir nota fiscal Mercado Pago",
    "nota fiscal Stripe",
    "nota fiscal Asaas",
    "nota fiscal Pagar.me",
    "nota fiscal Pix automática",
    "integração nota fiscal pagamento",
  ],
  answer:
    "Você conecta a plataforma de pagamento à Corvo, copiando um endereço de aviso para dentro dela. Quando uma venda é paga, a plataforma avisa a Corvo, e a nota fiscal de serviço é emitida sozinha. Funciona com Mercado Pago, Stripe, Asaas, Pagar.me, Woovi, AbacatePay e PushinPay. O reembolso cancela a nota, se você ligar essa regra.",
  blocks: [
    {
      kind: "p",
      text: "Receber pelo Pix ou pelo cartão e depois lembrar de emitir a nota é uma tarefa que se acumula. A integração tira essa tarefa da sua lista: **pagou, a Corvo emite**. Veja como funciona e o que cada plataforma faz.",
    },
    { kind: "h2", text: "Como a conexão funciona" },
    {
      kind: "ol",
      items: [
        "**Escolha a plataforma e a empresa** que vai emitir. Se a plataforma pedir, cole a chave de API. A Corvo só consulta os dados da venda.",
        "**Cole o endereço de aviso** na sua plataforma. A Corvo mostra o endereço e, quando precisa, um token ou segredo. A tela traz o passo a passo de cada plataforma.",
        "**Venda e pronto.** Cada pagamento aprovado vira uma nota. O cliente recebe a nota por e-mail quando a plataforma informa o e-mail dele.",
      ],
    },
    {
      kind: "p",
      text: "O mesmo aviso chegando duas vezes gera **uma nota só**. Nunca em dobro. A lista completa está na [página de integrações](/pt/integrations).",
    },
    { kind: "h2", text: "Quando a nota é emitida em cada plataforma" },
    {
      kind: "table",
      head: ["Plataforma", "O que paga", "A nota sai quando"],
      rows: [
        ["Mercado Pago", "Pagamentos", "O pagamento é aprovado"],
        ["Stripe", "Cobranças", "A cobrança é paga"],
        ["Asaas", "Pix, boleto e cartão", "O pagamento é recebido ou confirmado"],
        ["Pagar.me", "Pedidos", "O pedido é pago"],
        ["Woovi", "Cobranças Pix", "A cobrança é paga"],
        ["AbacatePay", "Pix, cartão e boleto", "O pagamento é concluído"],
        ["PushinPay", "Pix, boleto e Pix recorrente", "A cobrança é paga"],
      ],
    },
    { kind: "h2", text: "Detalhes que fazem diferença" },
    {
      kind: "ul",
      items: [
        "**Mercado Pago:** com o Access Token, a Corvo busca CPF ou CNPJ, e-mail e itens do pagamento. É só consulta.",
        "**Stripe:** você pode criar uma chave restrita, só de leitura, para a Corvo buscar CPF ou CNPJ, e-mail e itens. Ela é opcional.",
        "**Asaas:** desligue a emissão de nota do próprio Asaas, para a nota não sair duas vezes.",
        "**Pagar.me:** o reembolso parcial é ignorado.",
        "**Woovi:** se a cobrança não traz CPF ou CNPJ, a Corvo usa os dados de quem pagou o Pix. A devolução parcial é ignorada.",
        "**AbacatePay:** com a chave de API, a Corvo busca o CPF ou CNPJ completo e o nome dos produtos.",
        "**PushinPay:** ela não manda o e-mail do comprador. Por isso, a nota não vai por e-mail ao cliente sozinha.",
      ],
    },
    {
      kind: "p",
      text: "Cada conexão tem seu jeito de provar que o aviso é verdadeiro: assinatura, token, segredo ou usuário e senha. A Corvo cuida disso e mostra o que você precisa colar.",
    },
    { kind: "h2", text: "E se faltar o CPF ou o CNPJ?" },
    {
      kind: "p",
      text: "A venda espera na lista **Vendas pendentes** até você completar os dados. Depois, a nota sai. Nenhuma nota é emitida com dado faltando, e você não perde a venda.",
    },
    { kind: "h2", text: "Reembolso e chargeback" },
    {
      kind: "p",
      text: "Quando a plataforma avisa um reembolso, a Corvo cancela a nota, **se você ligar essa regra** na conexão. O cancelamento automático não vem ligado por padrão. Já o chargeback e a disputa, na maioria das plataformas, só deixam a venda marcada para você decidir. Todos os casos estão em [reembolso e chargeback: o que acontece com a nota fiscal](/pt/blog/reembolso-chargeback-nota-fiscal-cancelar).",
    },
    { kind: "h2", text: "Antes de conectar" },
    {
      kind: "ul",
      items: [
        "Cadastre a empresa e envie o [certificado digital A1](/pt/blog/certificado-digital-a1-o-que-e-quando-precisa), se for emitir de verdade.",
        "Teste antes. O ambiente de teste é grátis e as notas dele não têm valor fiscal.",
        "Confira com o seu contador a descrição do serviço e a regra de cancelamento que você vai ligar.",
      ],
    },
    {
      kind: "p",
      text: "A integração emite **NFS-e**, a nota de serviço. Para entender melhor, comece pelo [guia da NFS-e](/pt/blog/como-emitir-nota-fiscal-de-servico-nfse). Para detalhes técnicos, veja a [documentação das integrações de pagamento](/pt/docs/payment-integrations).",
    },
  ],
  faq: [
    {
      q: "Como emitir nota fiscal automática a cada venda?",
      a: "Conecte a sua plataforma de pagamento à Corvo, colando o endereço de aviso que a Corvo mostra. Cada pagamento aprovado vira uma nota fiscal de serviço, sem você precisar emitir.",
    },
    {
      q: "Quais plataformas de pagamento a Corvo aceita?",
      a: "Mercado Pago, Stripe, Asaas, Pagar.me, Woovi, AbacatePay e PushinPay, além de Hotmart, Kiwify, Eduzz e Monetizze para infoprodutos.",
    },
    {
      q: "A nota pode sair duas vezes para a mesma venda?",
      a: "Não. Se o mesmo aviso chegar duas vezes, a Corvo emite uma nota só. No Asaas, desligue também a emissão de nota do próprio Asaas.",
    },
    {
      q: "O que acontece se o comprador não informou o CPF?",
      a: "A venda fica em Vendas pendentes até você completar o CPF ou CNPJ. Depois disso, a nota é emitida.",
    },
    {
      q: "O cliente recebe a nota por e-mail?",
      a: "Sim, quando a plataforma informa o e-mail dele. A PushinPay não informa, então nessa conexão a nota não vai por e-mail sozinha.",
    },
    {
      q: "O reembolso cancela a nota?",
      a: "Cancela, se você ligar a regra de cancelamento automático da conexão. Reembolsos parciais são ignorados no Pagar.me e na Woovi.",
    },
  ],
  readNext: [
    "reembolso-chargeback-nota-fiscal-cancelar",
    "nota-fiscal-infoprodutor-hotmart-kiwify-eduzz-monetizze",
    "nota-fiscal-todo-mes-agendada",
  ],
};
