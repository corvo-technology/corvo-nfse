import type { BlogPost } from "../types";

export const post: BlogPost = {
  slug: "nota-fiscal-infoprodutor-hotmart-kiwify-eduzz-monetizze",
  title: "Nota fiscal para infoprodutor: Hotmart, Kiwify, Eduzz e Monetizze, pelo valor total ou só pela sua parte",
  seoTitle: "Nota fiscal para infoprodutor: Hotmart, Kiwify, Eduzz",
  description:
    "Vende curso ou e-book na Hotmart, Kiwify, Eduzz ou Monetizze? Veja como a Corvo emite a nota a cada venda, pelo valor total ou só pela sua parte.",
  publishedAt: "2026-11-27",
  updatedAt: "2026-11-27",
  cluster: "rotina",
  keywords: [
    "nota fiscal infoprodutor",
    "nota fiscal Hotmart",
    "nota fiscal Kiwify",
    "nota fiscal Eduzz",
    "nota fiscal Monetizze",
    "emitir nota fiscal curso online",
    "nota fiscal valor total ou parte",
  ],
  answer:
    "Conecte a Hotmart, a Kiwify, a Eduzz ou a Monetizze à Corvo e cada venda aprovada vira uma nota fiscal de serviço. Em cada conexão, você escolhe se a nota sai pelo valor total da venda ou só pela sua parte. Qual escolher depende do seu contrato e da sua situação: confirme com o seu contador.",
  blocks: [
    {
      kind: "p",
      text: "Quem vende curso, mentoria, e-book ou assinatura digital recebe dezenas ou centenas de vendas por mês. Emitir uma nota para cada uma, à mão, não funciona. A integração faz isso sozinha, e deixa você decidir sobre o valor da nota.",
    },
    { kind: "h2", text: "Como a Corvo emite a nota de cada plataforma" },
    {
      kind: "table",
      head: ["Plataforma", "A nota sai quando", "Cancela a nota quando"],
      rows: [
        ["Hotmart", "A compra é aprovada ou completa", "Reembolso ou chargeback. Um protesto só deixa a venda marcada"],
        ["Kiwify", "A compra é aprovada", "Reembolso. Chargeback deixa a venda marcada"],
        ["Eduzz", "A fatura é paga", "Reembolso, chargeback ou fatura cancelada"],
        ["Monetizze", "A venda é finalizada ou completa", "A venda é devolvida"],
      ],
    },
    {
      kind: "p",
      text: "O cancelamento automático é uma regra que **você liga** em cada conexão. Se ela estiver desligada, a nota não é cancelada sozinha. Veja o que acontece em cada caso em [reembolso e chargeback](/pt/blog/reembolso-chargeback-nota-fiscal-cancelar).",
    },
    { kind: "h2", text: "Valor total ou só a sua parte: qual escolher" },
    {
      kind: "p",
      text: "Na Hotmart, na Kiwify, na Eduzz e na Monetizze, você escolhe entre dois modos:",
    },
    {
      kind: "ul",
      items: [
        "**Valor total:** a nota sai pelo valor da venda inteira.",
        "**Só a sua parte:** a nota sai pelo valor que cabe a você. Na Hotmart, isso deixa de fora a parte de afiliados e coprodutores.",
      ],
    },
    {
      kind: "p",
      text: "Qual modo é o correto depende de como a venda é organizada: quem é o vendedor perante o cliente, como o contrato com a plataforma e com afiliados e coprodutores foi feito, e como o seu contador enquadra a operação. **A Corvo não decide isso por você, e este texto não substitui a orientação do contador.** Leve o seu contrato e um exemplo de venda para ele, e configure a Corvo com a resposta.",
    },
    { kind: "h2", text: "Passo a passo" },
    {
      kind: "ol",
      items: [
        "Cadastre a empresa na Corvo e, para emitir de verdade, envie o [certificado A1](/pt/blog/certificado-digital-a1-o-que-e-quando-precisa).",
        "Abra as [integrações](/pt/integrations), escolha a plataforma e a empresa que vai emitir.",
        "Copie o endereço de aviso e cole na sua plataforma. A tela mostra o passo a passo. Cada plataforma tem a sua forma de conferir o aviso: o Hottok na Hotmart, o token do aviso na Kiwify, a chave secreta na Eduzz e a chave única na Monetizze.",
        "Escolha **valor total** ou **só a sua parte**.",
        "Decida se liga o cancelamento automático em caso de reembolso.",
        "Faça uma venda de teste e confira a nota.",
      ],
    },
    { kind: "h2", text: "E se faltar o CPF ou o CNPJ do comprador?" },
    {
      kind: "p",
      text: "A venda espera em **Vendas pendentes** até você completar os dados. Depois, a nota sai. O mesmo aviso chegando duas vezes gera uma nota só. O cliente recebe a nota por e-mail quando a plataforma informa o e-mail dele.",
    },
    { kind: "h2", text: "Reembolso dentro do prazo de garantia" },
    {
      kind: "p",
      text: "Infoprodutos têm prazo de garantia, e o pedido de reembolso é comum. Com a regra ligada, a Corvo cancela a nota quando a plataforma avisa o reembolso. Na Hotmart e na Eduzz, o chargeback também conta como reembolso. Prazos para cancelar uma nota variam conforme a prefeitura. Consulte o seu contador.",
    },
    {
      kind: "callout",
      tone: "accent",
      text: "A integração emite **NFS-e**, a nota de serviço. Se você também vende produto físico, veja [qual nota fiscal emitir](/pt/blog/nfse-nfe-ou-nfce-qual-nota-fiscal-emitir).",
    },
    { kind: "h2", text: "Outras plataformas" },
    {
      kind: "p",
      text: "Se você recebe também por Pix, cartão ou gateway, veja [como conectar Mercado Pago, Stripe, Asaas, Pagar.me e Pix](/pt/blog/nota-fiscal-automatica-para-cada-venda-integracoes). A lista completa está na [página de integrações](/pt/integrations). A Corvo é open source, e quem sentir falta de uma plataforma pode contribuir com um conector.",
    },
  ],
  faq: [
    {
      q: "Infoprodutor precisa emitir nota fiscal?",
      a: "Depende do seu município, do seu regime e de como você vende. Confirme com o seu contador. Se você emite, a Corvo faz isso a cada venda, sem trabalho manual.",
    },
    {
      q: "A nota sai pelo valor total ou só pela minha parte?",
      a: "Você escolhe, em cada conexão. Na Hotmart, a nota só pela sua parte deixa de fora afiliados e coprodutores. Qual modo usar é uma decisão do seu contador.",
    },
    {
      q: "A Corvo funciona com a Hotmart, a Kiwify, a Eduzz e a Monetizze?",
      a: "Sim, com as quatro. Em todas, a nota sai quando a venda é aprovada ou paga, e você escolhe entre valor total e só a sua parte.",
    },
    {
      q: "O chargeback cancela a nota?",
      a: "Na Hotmart e na Eduzz, sim: o chargeback conta como reembolso. Na Kiwify, a venda só fica marcada para você decidir. Na Monetizze, o cancelamento acontece quando a venda é devolvida.",
    },
    {
      q: "O que acontece se o comprador não deixou CPF?",
      a: "A venda fica em Vendas pendentes até você completar os dados. Depois, a nota é emitida.",
    },
  ],
  readNext: [
    "reembolso-chargeback-nota-fiscal-cancelar",
    "nota-fiscal-automatica-para-cada-venda-integracoes",
    "como-emitir-nota-fiscal-de-servico-nfse",
  ],
};
