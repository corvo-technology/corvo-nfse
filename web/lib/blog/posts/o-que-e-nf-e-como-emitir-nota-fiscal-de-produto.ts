import type { BlogPost } from "../types";

export const post: BlogPost = {
  slug: "o-que-e-nf-e-como-emitir-nota-fiscal-de-produto",
  title: "O que é NF-e e como emitir nota fiscal de produto pela API e pelo painel",
  seoTitle: "O que é NF-e e como emitir nota fiscal de produto",
  description:
    "NF-e é a nota fiscal eletrônica de produto (modelo 55). Veja o que ela é, o que você precisa ter e como emitir pelo painel ou pela API da Corvo, em teste.",
  publishedAt: "2026-11-27",
  updatedAt: "2026-11-27",
  cluster: "basico",
  keywords: [
    "o que é NF-e",
    "como emitir NF-e",
    "nota fiscal de produto",
    "emitir NF-e pela API",
    "NF-e modelo 55",
    "DANFE",
    "carta de correção NF-e",
  ],
  answer:
    "NF-e é a nota fiscal eletrônica de produto, modelo 55. Ela acompanha a venda de mercadoria para empresa ou pessoa. Na Corvo, você emite pelo painel ou pela API, e recebe o DANFE em PDF e o XML. Por enquanto, a NF-e funciona só em teste (homologação), sem valor fiscal. A produção chega em breve.",
  blocks: [
    {
      kind: "p",
      text: "Vendeu uma camiseta, uma peça ou um lote de mercadoria para outra empresa? Em geral, quem vende **produto** emite a NF-e. Quem presta **serviço** emite a NFS-e. Este texto explica a primeira e mostra como ela funciona na Corvo.",
    },
    {
      kind: "callout",
      tone: "warn",
      text: "A NF-e da Corvo está em **teste (homologação)**. As notas emitidas agora **não têm valor fiscal**. A produção chega em breve. Use o teste para integrar e conferir tudo antes.",
    },
    { kind: "h2", text: "O que é a NF-e" },
    {
      kind: "p",
      text: "NF-e quer dizer Nota Fiscal Eletrônica. É a nota de **mercadoria**, no modelo 55. Ela é enviada à SEFAZ (a Secretaria da Fazenda do estado), que confere os dados e autoriza. Só depois da autorização a nota vale.",
    },
    {
      kind: "p",
      text: "O sistema é nacional, e o [Portal da NF-e](https://www.nfe.fazenda.gov.br/) reúne as regras e os manuais oficiais. Para saber se a sua operação precisa de NF-e e qual CFOP usar, converse com o seu contador.",
    },
    { kind: "h2", text: "O que você precisa ter antes" },
    {
      kind: "ul",
      items: [
        "**Empresa do Simples Nacional ou MEI.** Por enquanto, a Corvo só atende esses dois regimes na NF-e.",
        "**Inscrição estadual (IE)** da empresa, só com números. A Corvo confere se ela vale para o estado.",
        "**Endereço completo** da empresa: rua, número, bairro, CEP e município.",
        "**Certificado digital A1** da empresa, para emitir de verdade. No teste, não precisa. Veja [o que é o A1](/pt/blog/certificado-digital-a1-o-que-e-quando-precisa).",
        "**CFOP, NCM e CSOSN de cada item.** A Corvo **não calcula imposto**: você informa esses códigos como o seu contador orientar.",
      ],
    },
    { kind: "h2", text: "Como emitir pelo painel" },
    {
      kind: "ol",
      items: [
        "Abra a página da empresa e, na seção **NF-e**, preencha a inscrição estadual e confira se não falta nada.",
        "Clique em **Nova NF-e**.",
        "Digite o CNPJ ou o CEP do destinatário. O resto vem sozinho, e os clientes já usados ficam salvos.",
        "Adicione os itens, com descrição, quantidade, valor, NCM, CFOP e CSOSN.",
        "Informe a forma de pagamento. O total pago precisa fechar com o total da nota.",
        "Clique em **Validar**. A Corvo confere tudo e mostra todos os problemas de uma vez. Nada é enviado ao governo nesse passo.",
        "Corrigiu? Clique em **Emitir**. Quando a SEFAZ autoriza, o DANFE e o XML ficam prontos para baixar.",
      ],
    },
    {
      kind: "p",
      text: "A NF-e só aparece no painel quando está liberada para a sua conta. Se você não vê a opção, fale com a Corvo.",
    },
    { kind: "h2", text: "Como emitir pela API" },
    {
      kind: "p",
      text: "A NF-e usa a mesma rota e a mesma chave de API da NFS-e. O que muda é o campo `type`: mande `nfe` para nota de produto. Sem esse campo, a chamada continua sendo uma NFS-e, como sempre foi.",
    },
    {
      kind: "code",
      label: "POST /v1/invoices (resumido)",
      language: "json",
      code: `{
  "type": "nfe",
  "companyId": "ID-DA-EMPRESA",
  "recipient": { "taxId": "123.456.789-09", "name": "Maria da Silva", "indIeDest": 9 },
  "items": [
    {
      "description": "Camiseta de algodão",
      "ncm": "61091000",
      "cfop": "5102",
      "unit": "UN",
      "quantity": 2,
      "unitPrice": 10,
      "tax": { "csosn": "102" }
    }
  ],
  "payments": [{ "tPag": "17", "amount": 20 }]
}`,
    },
    {
      kind: "p",
      text: "Antes de emitir, use a rota de validação. Ela recebe o mesmo corpo, confere a nota com as regras e o layout oficial, e **não envia nada à SEFAZ nem gasta crédito**. Para emitir, mande o mesmo corpo com uma chave única por pedido: se você repetir a chamada por engano, a mesma nota volta e nunca nascem duas. Os detalhes estão na [documentação da NF-e](/pt/docs/nfe-issue).",
    },
    { kind: "h2", text: "O que você recebe depois da autorização" },
    {
      kind: "ul",
      items: [
        "**DANFE em PDF**, a versão para imprimir da nota.",
        "**XML autorizado**, o arquivo oficial que seu contador pede.",
        "**E-mail ao destinatário** com os dois arquivos, quando você informa o e-mail dele.",
        "**Avisos automáticos** para o seu sistema a cada mudança de situação. Uma recusa da SEFAZ vem com o código e o motivo.",
      ],
    },
    { kind: "h2", text: "Errou? Corrija, cancele ou reenvie" },
    {
      kind: "ul",
      items: [
        "**Nota rejeitada:** corrija o que a SEFAZ recusou e envie de novo. A nota mantém o mesmo número.",
        "**Carta de correção (CC-e):** corrige texto e alguns dados, sem cancelar. Ela **não** muda valores, impostos, as partes (quem emite e quem recebe) nem as datas. A carta existe só na NF-e, não na NFC-e.",
        "**Cancelamento:** feito com uma justificativa. A SEFAZ tem um prazo para aceitar o cancelamento, que varia. Consulte seu contador ou a SEFAZ do seu estado.",
      ],
    },
    { kind: "h2", text: "Quanto custa" },
    {
      kind: "p",
      text: "A NF-e usa o **mesmo crédito da NFS-e**. Cada nota autorizada gasta um crédito do plano. Se a nota for rejeitada ou descartada, o crédito volta. Cancelar uma nota que já foi autorizada não devolve o crédito. Em teste, é grátis. Veja mais na [página da NF-e](/pt/nf-e).",
    },
    { kind: "h2", text: "E se eu vendo no balcão?" },
    {
      kind: "p",
      text: "Venda direta ao consumidor, no caixa, costuma usar outra nota, a NFC-e. Leia [o que é NFC-e](/pt/blog/o-que-e-nfc-e-cupom-fiscal-eletronico) ou compare as três no texto [NFS-e, NF-e ou NFC-e](/pt/blog/nfse-nfe-ou-nfce-qual-nota-fiscal-emitir).",
    },
  ],
  faq: [
    {
      q: "O que é NF-e?",
      a: "É a nota fiscal eletrônica de produto, modelo 55. Ela registra a venda de mercadoria e só vale depois que a SEFAZ autoriza.",
    },
    {
      q: "A NF-e da Corvo já vale de verdade?",
      a: "Ainda não. Ela está disponível em teste (homologação), e as notas emitidas nesse ambiente não têm valor fiscal. A produção chega em breve.",
    },
    {
      q: "A Corvo calcula os impostos da NF-e?",
      a: "Não. Você informa o CFOP, o NCM e o CSOSN de cada item, como o seu contador orientar. A Corvo monta a nota, confere e envia.",
    },
    {
      q: "Para quais empresas a NF-e da Corvo serve?",
      a: "Para empresas do Simples Nacional e MEI. Outros regimes ainda não são aceitos. Segundo a página da NF-e, ela funciona em todos os estados, sem configuração extra por estado.",
    },
    {
      q: "Posso conferir a nota antes de enviar?",
      a: "Pode. A validação faz as mesmas conferências da emissão, mostra todos os problemas de uma vez e não envia nada à SEFAZ nem gasta crédito.",
    },
    {
      q: "Dá para corrigir uma NF-e já autorizada?",
      a: "Em parte. A carta de correção ajusta texto e alguns dados, mas não muda valores, impostos, quem emite, quem recebe nem as datas. Nesses casos, fale com o seu contador sobre cancelar e emitir outra.",
    },
  ],
  readNext: [
    "nfse-nfe-ou-nfce-qual-nota-fiscal-emitir",
    "o-que-e-nfc-e-cupom-fiscal-eletronico",
    "certificado-digital-a1-o-que-e-quando-precisa",
  ],
};
