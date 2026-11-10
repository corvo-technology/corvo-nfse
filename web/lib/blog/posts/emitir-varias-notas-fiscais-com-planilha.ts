import type { BlogPost } from "../types";

export const post: BlogPost = {
  slug: "emitir-varias-notas-fiscais-com-planilha",
  title: "Como emitir várias notas fiscais de uma vez usando uma planilha",
  seoTitle: "Emitir várias notas fiscais de uma vez com planilha",
  description:
    "Tem muitas notas de serviço para emitir no mês? Veja como enviar uma planilha Excel ou CSV, conferir cada linha e emitir tudo de uma vez na Corvo.",
  publishedAt: "2026-11-10",
  updatedAt: "2026-11-10",
  cluster: "rotina",
  keywords: [
    "emitir várias notas fiscais",
    "emitir nota fiscal por planilha",
    "emitir NFS-e em lote",
    "importar planilha nota fiscal",
    "nota fiscal Excel",
    "emitir notas fiscais de uma vez",
  ],
  answer:
    "Na Corvo, você pode emitir várias notas de serviço de uma vez enviando uma planilha em Excel (.xlsx) ou CSV, com até 2.000 linhas. A Corvo confere cada linha e mostra quais estão prontas e quais têm erro. Você corrige o que precisar e clica para emitir todas as notas prontas de uma só vez.",
  blocks: [
    {
      kind: "p",
      text: "Quem presta o mesmo tipo de serviço para muita gente, como uma clínica, uma escola, um profissional que atende empresas ou um estúdio, conhece o fim do mês: uma lista de clientes e o mesmo formulário preenchido dezenas de vezes. A planilha troca isso por um envio só.",
    },
    { kind: "h2", text: "O que você precisa" },
    {
      kind: "ul",
      items: [
        "**Uma conta na Corvo** com a empresa emissora já cadastrada. Se ainda não fez isso, veja o [guia de como emitir nota fiscal de serviço](/pt/blog/como-emitir-nota-fiscal-de-servico-nfse).",
        "**Uma planilha** em Excel (.xlsx) ou CSV, com até **2.000 linhas** e **10 MB**.",
        "**Os dados de cada nota:** quem é o cliente (tomador), qual foi o serviço e o valor.",
      ],
    },
    { kind: "h2", text: "Passo a passo" },
    {
      kind: "ol",
      items: [
        "No painel, na área de notas, clique em **Importar planilha**.",
        "Clique em **Baixar modelo**. É uma planilha já com as colunas certas, para você só preencher.",
        "Preencha uma linha para cada nota e salve o arquivo.",
        "Escolha a **empresa que emite**. Se a sua planilha tem uma coluna com o CNPJ, a Corvo usa a empresa indicada em cada linha.",
        "Envie a planilha. A Corvo **lê o arquivo** e **confere cada linha**. Leva só alguns segundos.",
        "Veja o resumo: quantas linhas estão **prontas** e quantas têm **erro**. Use o filtro **Com erro** para ver só as que precisam de ajuste.",
        "Corrija o que for preciso e clique em **Emitir** as notas prontas. O botão mostra quantas notas serão emitidas e o valor total.",
      ],
    },
    {
      kind: "callout",
      tone: "accent",
      text: "Faça o primeiro teste no **ambiente de teste**, com poucas linhas. As notas de teste não têm valor fiscal, não usam as notas do seu plano e você vê como a importação funciona sem risco. Na hora de emitir de verdade, use CPF e CNPJ **reais**: a prefeitura confere os dados no cadastro e recusa os inventados.",
    },
    { kind: "h2", text: "A Corvo avisa antes de emitir" },
    {
      kind: "p",
      text: "Você não emite no escuro. Depois do envio, a Corvo mostra a lista de linhas com o cliente, o serviço, o valor e a situação (**Pronta** ou **Corrigir**). Se alguma coluna da planilha não for reconhecida, ela avisa quais foram ignoradas. Se você enviar a mesma planilha duas vezes, ela também avisa, para evitar notas em dobro por descuido.",
    },
    {
      kind: "p",
      text: "Uma linha com o CNPJ de outra empresa que não a escolhida é recusada. Dá para **baixar só os erros** em um arquivo, corrigir e enviar de novo. Se as notas do seu plano acabarem no meio da emissão, as que faltam ficam **aguardando créditos** até você resolver.",
    },
    { kind: "h2", text: "Quando a planilha é a melhor opção" },
    {
      kind: "table",
      head: ["Situação", "Melhor jeito"],
      rows: [
        ["Muitos clientes diferentes no mesmo mês", "Planilha"],
        ["O mesmo cliente e o mesmo valor, todo mês", "[Agenda de nota recorrente](/pt/blog/nota-fiscal-todo-mes-agendada)"],
        ["Uma nota avulsa agora", "Emitir pelo painel"],
      ],
    },
    {
      kind: "p",
      text: "Se o seu sistema de vendas já tem os dados, um programador pode ligar tudo direto à Corvo por API. Os detalhes estão na [documentação](/pt/docs/invoices). Mas, para a maioria dos casos, a planilha resolve sem escrever código.",
    },
  ],
  faq: [
    {
      q: "Quantas notas posso emitir de uma vez pela planilha?",
      a: "A planilha pode ter até 2.000 linhas e 10 MB. Se tiver mais, divida em arquivos menores.",
    },
    {
      q: "Que tipo de arquivo a Corvo aceita?",
      a: "CSV ou Excel (.xlsx). No painel, há um modelo para baixar, já com as colunas certas.",
    },
    {
      q: "E se algumas linhas tiverem erro?",
      a: "A Corvo mostra quais linhas estão prontas e quais têm erro. Você corrige as que tiverem erro e emite as notas prontas. Também dá para baixar só os erros em um arquivo.",
    },
    {
      q: "Posso testar a importação sem emitir notas de verdade?",
      a: "Sim. No ambiente de teste as notas não têm valor fiscal. É a melhor forma de conhecer o processo antes de emitir de verdade.",
    },
    {
      q: "Corro o risco de emitir a mesma nota duas vezes?",
      a: "A Corvo avisa quando você envia a mesma planilha de novo. Se foi de propósito, é só seguir; se foi sem querer, descarte a importação.",
    },
  ],
  readNext: ["nota-fiscal-todo-mes-agendada", "como-emitir-nota-fiscal-de-servico-nfse"],
};
