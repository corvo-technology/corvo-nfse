import type { BlogPost } from "../types";

export const post: BlogPost = {
  slug: "nfse-nfe-ou-nfce-qual-nota-fiscal-emitir",
  title: "NFS-e, NF-e ou NFC-e: qual nota fiscal emitir?",
  seoTitle: "NFS-e, NF-e ou NFC-e: qual nota fiscal emitir?",
  description:
    "Serviço, produto ou venda no balcão? Compare NFS-e, NF-e e NFC-e numa tabela simples e veja qual nota fiscal combina com o que a sua empresa vende.",
  publishedAt: "2026-11-27",
  updatedAt: "2026-11-27",
  cluster: "basico",
  keywords: [
    "diferença entre NFS-e NF-e e NFC-e",
    "qual nota fiscal emitir",
    "nota fiscal de serviço ou produto",
    "NF-e ou NFC-e",
    "tipos de nota fiscal",
    "nota fiscal de consumidor",
  ],
  answer:
    "Presta serviço? Emita a NFS-e. Vende produto para empresa ou pessoa, com entrega ou transporte? Emita a NF-e. Vende produto direto ao consumidor, no balcão ou por delivery? Em geral, é a NFC-e. Quem faz as duas coisas emite mais de um tipo. Confirme o seu caso com o contador.",
  blocks: [
    {
      kind: "p",
      text: "Três siglas parecidas, três notas diferentes. A pergunta que decide tudo é simples: **o que você vende e para quem?** Este texto ajuda você a chegar na resposta e mostra o que a Corvo emite de cada uma.",
    },
    { kind: "h2", text: "A resposta rápida" },
    {
      kind: "ul",
      items: [
        "**Você faz um trabalho, uma consultoria, um conserto, uma aula?** É serviço. Nota: **NFS-e**.",
        "**Você vende mercadoria para outra empresa, para um revendedor ou para uma pessoa, com envio?** É produto. Nota: **NF-e**.",
        "**Você vende mercadoria ao consumidor final, no caixa da loja ou no delivery?** É varejo. Nota: **NFC-e**.",
      ],
    },
    { kind: "h2", text: "Comparação lado a lado" },
    {
      kind: "table",
      head: ["", "NFS-e", "NF-e", "NFC-e"],
      rows: [
        ["O que documenta", "Serviço", "Produto (modelo 55)", "Produto ao consumidor (modelo 65)"],
        ["Quem recebe", "Empresa ou pessoa", "Empresa ou pessoa, com endereço", "Consumidor final, sem precisar se identificar"],
        ["Onde é usada", "Consultoria, aulas, manutenção, assinaturas", "Loja virtual, atacado, venda entre empresas", "Balcão, caixa, delivery"],
        ["Quem autoriza", "A prefeitura ou o ambiente nacional da NFS-e", "A SEFAZ do estado", "A SEFAZ do estado"],
        ["Documento", "Nota de serviço em PDF", "DANFE (A4)", "Cupom com QR Code (80 mm ou A4)"],
        ["Carta de correção", "Não", "Sim, em casos limitados", "Não: cancela e emite de novo"],
        ["Na Corvo hoje", "Emissão de verdade", "Só em teste (homologação)", "Só em teste (homologação), começa por SP"],
      ],
    },
    {
      kind: "callout",
      tone: "warn",
      text: "A NF-e e a NFC-e da Corvo estão em **teste (homologação)**: as notas emitidas nesse ambiente **não têm valor fiscal**. A produção chega em breve. A NFS-e já emite de verdade.",
    },
    { kind: "h2", text: "NFS-e: nota de serviço" },
    {
      kind: "p",
      text: "É a nota de quem **presta serviço**. Hoje a emissão acontece no ambiente nacional ou na prefeitura, e a Corvo emite para MEI e Simples Nacional. Se este é o seu caso, comece pelo [guia de como emitir nota fiscal de serviço](/pt/blog/como-emitir-nota-fiscal-de-servico-nfse).",
    },
    { kind: "h2", text: "NF-e: nota de produto" },
    {
      kind: "p",
      text: "É a nota de **mercadoria**, enviada à SEFAZ para autorização. Serve para vender a outra empresa ou a uma pessoa, sobretudo quando há entrega. O destinatário é obrigatório, com endereço. Você recebe o DANFE e o XML. Veja o texto [o que é NF-e e como emitir](/pt/blog/o-que-e-nf-e-como-emitir-nota-fiscal-de-produto) e a [página da NF-e](/pt/nf-e).",
    },
    { kind: "h2", text: "NFC-e: cupom do consumidor" },
    {
      kind: "p",
      text: "É o cupom fiscal eletrônico do **varejo**. O consumidor pode ficar sem se identificar e confere a compra pelo QR Code. Se a SEFAZ não responde, existe a contingência offline. Veja [o que é NFC-e](/pt/blog/o-que-e-nfc-e-cupom-fiscal-eletronico) e a [página da NFC-e](/pt/nfc-e).",
    },
    { kind: "h2", text: "E se eu vendo produto e serviço?" },
    {
      kind: "p",
      text: "Acontece bastante: a loja que vende o aparelho e cobra a instalação, ou o estúdio que vende o curso e o material impresso. Cada parte pode pedir uma nota diferente. Como separar, e como tratar a operação, depende do município, do estado e do regime da empresa. **Pergunte ao seu contador** antes de decidir.",
    },
    {
      kind: "p",
      text: "Na Corvo, as três notas usam a **mesma chave de API** e o **mesmo crédito**. Você escolhe o tipo com o campo `type`: sem ele, a nota é NFS-e. Ver a [documentação da API](/pt/docs).",
    },
    { kind: "h2", text: "O que a Corvo não faz" },
    {
      kind: "ul",
      items: [
        "**Não calcula imposto.** Na NF-e e na NFC-e, você informa o CFOP, o NCM e o CSOSN de cada item.",
        "**Só atende MEI e Simples Nacional.** Outros regimes ainda não são aceitos.",
        "**Não decide por você qual nota emitir.** Essa decisão fiscal é do contador.",
      ],
    },
    {
      kind: "p",
      text: "As regras oficiais das notas de produto ficam no [Portal da NF-e](https://www.nfe.fazenda.gov.br/).",
    },
  ],
  faq: [
    {
      q: "Qual a diferença entre NFS-e e NF-e?",
      a: "A NFS-e documenta serviço e a NF-e documenta produto (mercadoria). Quem presta serviço emite NFS-e. Quem vende mercadoria emite NF-e ou NFC-e.",
    },
    {
      q: "Qual a diferença entre NF-e e NFC-e?",
      a: "A NF-e é para vender a empresa ou pessoa, com destinatário e endereço, e gera o DANFE. A NFC-e é para o consumidor final no balcão ou no delivery, não exige identificação e gera um cupom com QR Code.",
    },
    {
      q: "Posso emitir NF-e para o consumidor final?",
      a: "Tecnicamente a NF-e aceita pessoas como destinatárias, mas no varejo o comum é a NFC-e. Qual usar depende da operação e do estado. Pergunte ao seu contador.",
    },
    {
      q: "A Corvo emite as três notas?",
      a: "Sim, com uma diferença: a NFS-e emite de verdade, e a NF-e e a NFC-e estão em teste (homologação), sem valor fiscal. A produção dessas duas chega em breve.",
    },
    {
      q: "As três notas gastam o mesmo crédito?",
      a: "Sim. Cada nota autorizada usa um crédito do plano. Na NF-e, uma nota rejeitada ou descartada devolve o crédito. Em teste, é grátis.",
    },
  ],
  readNext: [
    "o-que-e-nf-e-como-emitir-nota-fiscal-de-produto",
    "o-que-e-nfc-e-cupom-fiscal-eletronico",
    "como-emitir-nota-fiscal-de-servico-nfse",
  ],
};
