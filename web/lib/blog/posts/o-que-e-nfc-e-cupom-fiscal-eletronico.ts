import type { BlogPost } from "../types";

export const post: BlogPost = {
  slug: "o-que-e-nfc-e-cupom-fiscal-eletronico",
  title: "O que é NFC-e (cupom fiscal eletrônico): quem precisa, QR Code e contingência offline",
  seoTitle: "O que é NFC-e: cupom fiscal, QR Code e contingência",
  description:
    "NFC-e é o cupom fiscal eletrônico do varejo. Entenda para quem serve, como o QR Code funciona, o que é a contingência offline e como emitir pela Corvo, em teste.",
  publishedAt: "2026-11-27",
  updatedAt: "2026-11-27",
  cluster: "basico",
  keywords: [
    "o que é NFC-e",
    "cupom fiscal eletrônico",
    "NFC-e QR Code",
    "NFC-e contingência offline",
    "nota fiscal de consumidor",
    "emitir NFC-e pela API",
    "DANFCE",
  ],
  answer:
    "NFC-e é a Nota Fiscal de Consumidor Eletrônica, o cupom fiscal digital da venda no balcão (modelo 65). O cupom traz um QR Code para o cliente conferir a compra no site da SEFAZ. Na Corvo, a NFC-e está em teste (homologação), começa por São Paulo e tem contingência offline de até 24 horas.",
  blocks: [
    {
      kind: "p",
      text: "Quem tem loja, lanchonete, padaria ou delivery conhece o cupom que sai no caixa. Hoje, esse cupom é digital e se chama NFC-e. Veja o que ela é, como o QR Code funciona e o que fazer quando a SEFAZ não responde.",
    },
    {
      kind: "callout",
      tone: "warn",
      text: "A NFC-e da Corvo está em **teste (homologação)**: as notas emitidas agora **não têm valor fiscal**. Ela começa por **São Paulo**, e os outros estados entram depois. A produção chega em breve.",
    },
    { kind: "h2", text: "O que é a NFC-e" },
    {
      kind: "p",
      text: "NFC-e é a **Nota Fiscal de Consumidor Eletrônica**, modelo 65. Ela documenta a venda ao **consumidor final**, no balcão ou por entrega. Substitui o antigo cupom da impressora fiscal. A nota é autorizada pela SEFAZ do estado, e o [Portal da NF-e](https://www.nfe.fazenda.gov.br/) reúne as informações oficiais.",
    },
    {
      kind: "p",
      text: "O consumidor pode ficar sem se identificar. O CPF é opcional na maioria das vendas. A partir de um limite definido pelo estado, a identificação passa a ser obrigatória. Na Corvo, o limite padrão é de R$ 10.000,00. Confira o valor do seu estado com o contador.",
    },
    { kind: "h2", text: "Quem precisa emitir NFC-e" },
    {
      kind: "p",
      text: "A obrigação depende do estado, do tipo de atividade e do regime da empresa. Quem vende ao consumidor final em geral precisa de um documento fiscal, e a NFC-e é o modelo usado no varejo. Mas não existe uma regra única para todo mundo. **Consulte seu contador ou a SEFAZ do seu estado** para saber se a sua empresa precisa emitir, e desde quando.",
    },
    {
      kind: "p",
      text: "Para emitir pela Corvo, a empresa deve ser do **Simples Nacional ou MEI**, e a inscrição estadual precisa estar **credenciada para NFC-e** na SEFAZ. O credenciamento é feito uma vez, no site da SEFAZ, pela empresa ou pelo contador.",
    },
    { kind: "h2", text: "Como funciona o QR Code" },
    {
      kind: "p",
      text: "Quando a SEFAZ autoriza a nota, o cupom sai com um **QR Code** e com a chave de acesso. O consumidor aponta a câmera do celular e abre a página da SEFAZ com a compra. Assim ele confere que a nota existe e que os dados batem.",
    },
    {
      kind: "p",
      text: "Na Corvo, você não cadastra o código de segurança do estado (o CSC). Ela usa a versão do QR Code que dispensa esse código, então você não tem nada para guardar. O cupom pode ser impresso em **80 mm**, para a impressora térmica do caixa, ou em **A4**, para mandar por e-mail.",
    },
    { kind: "h2", text: "O que é a contingência offline" },
    {
      kind: "p",
      text: "A venda no balcão não espera. Se a SEFAZ não responde, o cliente fica na fila. Para esse caso existe a **contingência offline**: a Corvo numera e assina a nota na hora, e você entrega o cupom, que já sai com o aviso de contingência. A nota vai à SEFAZ depois, **em até 24 horas**.",
    },
    {
      kind: "ul",
      items: [
        "Você pode **pedir** a contingência numa nota específica, pela API.",
        "Ou pode ligar, na empresa, a opção de emitir offline **automaticamente**. Ela vem **desligada** por padrão. Ligada, a nota sai offline sozinha quando a SEFAZ não responde.",
        "Perto do fim do prazo, a Corvo avisa o seu sistema. Depois de 24 horas, ela ainda tenta enviar.",
      ],
    },
    {
      kind: "callout",
      tone: "accent",
      text: "Atenção: uma nota offline pode ser **rejeitada depois**, quando já estiver com o cliente. Nesse caso, só dá para corrigir alguns campos de texto. Se não bastar, converse com o seu contador.",
    },
    { kind: "h2", text: "Erro na NFC-e: cancelar, não corrigir" },
    {
      kind: "p",
      text: "A NFC-e **não tem carta de correção** (CC-e). Se a venda saiu errada, você cancela a nota, com uma justificativa, e emite outra. O prazo para cancelar é curto e definido pelo estado. Confira com a SEFAZ ou com o contador antes de contar com ele.",
    },
    { kind: "h2", text: "Como emitir pela Corvo" },
    {
      kind: "ol",
      items: [
        "Cadastre a empresa, com inscrição estadual e endereço.",
        "Peça a liberação da NFC-e para a sua conta, se ainda não tiver.",
        "Monte a venda com `type` igual a `nfce`, os itens (com CFOP, NCM e CSOSN, que **você informa**: a Corvo não calcula imposto) e a forma de pagamento.",
        "Valide e emita. A nota volta com o QR Code e o cupom em 80 mm ou A4.",
      ],
    },
    {
      kind: "p",
      text: "Dinheiro, Pix, cartão com bandeira e mais de uma forma de pagamento na mesma venda funcionam, assim como o troco. Venda com entrega leva o endereço do consumidor na nota. Veja a [página da NFC-e](/pt/nfc-e) e a [documentação](/pt/docs/nfce).",
    },
    {
      kind: "p",
      text: "Vende para empresa, e não para o consumidor? Leia [o que é NF-e](/pt/blog/o-que-e-nf-e-como-emitir-nota-fiscal-de-produto) ou compare as notas em [NFS-e, NF-e ou NFC-e](/pt/blog/nfse-nfe-ou-nfce-qual-nota-fiscal-emitir).",
    },
  ],
  faq: [
    {
      q: "O que é NFC-e?",
      a: "É a Nota Fiscal de Consumidor Eletrônica, modelo 65. Ela documenta a venda ao consumidor final e substitui o cupom da impressora fiscal.",
    },
    {
      q: "Preciso de impressora fiscal para emitir NFC-e?",
      a: "Pela Corvo, não. A nota é emitida pela API ou pelo painel, e o cupom pode ser impresso em uma impressora térmica comum de 80 mm ou enviado em A4.",
    },
    {
      q: "O cliente precisa dar o CPF?",
      a: "Na maioria das vendas, não. O consumidor pode ficar sem identificação. A partir do limite do estado, o CPF ou CNPJ passa a ser obrigatório.",
    },
    {
      q: "O que acontece se a SEFAZ estiver fora do ar?",
      a: "Na contingência offline, a Corvo numera, assina e responde na hora, e envia a nota à SEFAZ depois, em até 24 horas. A opção automática vem desligada, e você escolhe se liga.",
    },
    {
      q: "A NFC-e da Corvo já funciona em todos os estados?",
      a: "Não. Ela está em teste (homologação) e começa por São Paulo. Os outros estados entram depois de testados, e a produção chega em breve.",
    },
    {
      q: "Posso corrigir uma NFC-e com carta de correção?",
      a: "Não. A carta de correção existe só na NF-e. Na NFC-e, você cancela a nota com justificativa e emite outra.",
    },
  ],
  readNext: [
    "nfse-nfe-ou-nfce-qual-nota-fiscal-emitir",
    "o-que-e-nf-e-como-emitir-nota-fiscal-de-produto",
    "como-emitir-nota-fiscal-de-servico-nfse",
  ],
};
