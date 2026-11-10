import type { BlogPost } from "../types";

export const post: BlogPost = {
  slug: "como-emitir-nota-fiscal-de-servico-nfse",
  title: "Como emitir nota fiscal de serviço (NFS-e): guia simples para MEI e Simples Nacional",
  seoTitle: "Como emitir nota fiscal de serviço (NFS-e) para MEI",
  description:
    "Entenda o que é a NFS-e, quem precisa emitir e os três jeitos de emitir a nota de serviço: no portal do governo, com a Corvo ou pelo seu contador.",
  publishedAt: "2026-11-10",
  updatedAt: "2026-11-10",
  cluster: "basico",
  keywords: [
    "como emitir nota fiscal de serviço",
    "NFS-e",
    "nota fiscal MEI",
    "NFS-e Simples Nacional",
    "emissor nacional NFS-e",
    "emitir nota fiscal de serviço online",
  ],
  answer:
    "Para emitir a nota fiscal de serviço (NFS-e), você usa o sistema nacional do governo ou um emissor, como a Corvo. No portal, o MEI entra com a conta gov.br e preenche os dados a cada nota. Na Corvo, você cadastra a empresa uma vez e depois emite pelo painel, por planilha, por agenda ou conversando com um assistente de IA.",
  blocks: [
    {
      kind: "p",
      text: "Prestou o serviço, o cliente pagou e falta a nota. Aqui estão as regras básicas e as formas de emitir, com cada termo explicado na primeira vez que aparece.",
    },
    { kind: "h2", text: "O que é a NFS-e" },
    {
      kind: "p",
      text: "A **NFS-e** é a nota fiscal de serviço eletrônica. É o documento que comprova que você prestou um serviço (uma aula, uma consultoria, um corte de cabelo, uma manutenção, um projeto de design) e que o imposto dessa prestação foi declarado.",
    },
    {
      kind: "p",
      text: "Quem vende **produto** emite outra nota, a NF-e. É outro assunto, e a Corvo não emite esse tipo de nota.",
    },
    {
      kind: "p",
      text: "Antes, cada prefeitura tinha o próprio sistema de nota. Hoje existe um sistema único do governo, o **Emissor Nacional**, e a nota emitida nele é a NFS-e “no padrão nacional”.",
    },
    { kind: "h2", text: "Quem precisa emitir no padrão nacional" },
    {
      kind: "ul",
      items: [
        "**MEI:** a emissão pelo padrão nacional é obrigatória desde 1º de setembro de 2023 para quem presta serviço a outra empresa (CNPJ). Para cliente pessoa física, a nota segue opcional.",
        "**Microempresa (ME) e empresa de pequeno porte (EPP) do Simples Nacional:** obrigatória desde 1º de novembro de 2026. Explicamos em [NFS-e do Simples Nacional: o que mudou em novembro de 2026](/pt/blog/simples-nacional-nfse-nacional-novembro-2026).",
      ],
    },
    {
      kind: "callout",
      tone: "accent",
      text: "Regras fiscais mudam. Confirme com o seu contador e na [página oficial do governo sobre a NFS-e](https://www.gov.br/pt-br/servicos/emitir-nota-fiscal-de-servico-eletronica) antes de decidir.",
    },
    { kind: "h2", text: "Três jeitos de emitir a nota" },
    {
      kind: "table",
      head: ["Jeito", "Como funciona", "Bom para"],
      rows: [
        [
          "Portal do governo",
          "Você entra e preenche um formulário a cada nota. O MEI entra com a conta gov.br (nível prata ou ouro), sem certificado digital.",
          "Quem emite poucas notas por mês.",
        ],
        [
          "Emissor, como a Corvo",
          "Você cadastra a empresa uma vez e emite pelo painel, por planilha, por agenda ou conversando com um assistente de IA.",
          "Quem emite todo mês, para vários clientes ou para mais de uma empresa.",
        ],
        ["Contador", "Você passa os dados e ele emite a nota.", "Quem prefere não mexer com isso."],
      ],
    },
    { kind: "h2", text: "Como começar na Corvo, passo a passo" },
    {
      kind: "ol",
      items: [
        "Crie a conta. É grátis e não pede cartão de crédito.",
        "**Cadastre a empresa:** razão social, CNPJ, se é MEI ou Simples Nacional e o município. Antes de emitir notas de verdade, o painel também pede a **inscrição municipal** da empresa.",
        "Emita uma nota de teste. Ela não tem valor fiscal, não precisa de certificado e não custa nada. Serve para você conhecer o painel sem medo de errar.",
        "**Envie o certificado digital A1 da empresa** para emitir notas de verdade. Não sabe o que é isso? Veja o [guia do certificado digital A1](/pt/blog/certificado-digital-a1-o-que-e-quando-precisa).",
        "Emita a nota real. A primeira é grátis.",
      ],
    },
    { kind: "h2", text: "O que a Corvo faz por você" },
    {
      kind: "ul",
      items: [
        "Mostra os tributos da nota **antes** de emitir, para você ver o valor líquido.",
        "Entrega a nota pronta, com PDF e XML, e pode enviá-la por e-mail ao seu cliente.",
        "Deixa você emitir várias notas de uma vez por [planilha](/pt/blog/emitir-varias-notas-fiscais-com-planilha) e repetir a nota todo mês com a [agenda](/pt/blog/nota-fiscal-todo-mes-agendada).",
        "Guarda o certificado da empresa criptografado.",
      ],
    },
    {
      kind: "p",
      text: "A Corvo **não** emite nota de produto (NF-e), não atende empresas fora do MEI e do Simples Nacional e não gera a guia do DAS.",
    },
    { kind: "h2", text: "E se eu não entendo de imposto?" },
    {
      kind: "p",
      text: "Você não precisa entender. O MEI não informa alíquota nenhuma. A ME e a EPP informam uma vez, ao cadastrar a empresa, a alíquota efetiva do Simples Nacional, que é o número que o seu contador já conhece. O resto, a Corvo calcula antes de emitir.",
    },
    {
      kind: "p",
      text: "Quem quiser integrar a emissão ao próprio sistema pode ver os detalhes na [documentação da API](/pt/docs). Para quem só quer emitir a nota, o painel resolve.",
    },
  ],
  faq: [
    {
      q: "O MEI precisa de certificado digital para emitir nota de serviço?",
      a: "No portal do governo, não: o MEI entra com a conta gov.br em nível prata ou ouro. Para emitir pela Corvo uma nota de verdade, a empresa precisa do certificado digital A1. No ambiente de teste, não precisa de nenhum.",
    },
    {
      q: "Posso testar antes de emitir uma nota de verdade?",
      a: "Pode. O ambiente de teste é grátis e as notas emitidas nele não têm valor fiscal. Use para conhecer o painel e conferir os dados antes de emitir de verdade.",
    },
    {
      q: "A Corvo emite nota de produto?",
      a: "Não. A Corvo emite só NFS-e, a nota de serviço. Nota de produto (NF-e) e nota de varejo (NFC-e) não fazem parte do que ela oferece.",
    },
    {
      q: "Quanto custa emitir a primeira nota?",
      a: "A primeira nota é grátis, sem cartão de crédito. O ambiente de teste também é sempre grátis. Os planos e o preço das notas seguintes ficam na seção de preços do site.",
    },
    {
      q: "Preciso saber a alíquota do Simples Nacional?",
      a: "Só se a empresa for ME ou EPP: você informa a alíquota efetiva uma vez, ao cadastrar a empresa, e seu contador sabe qual é. O MEI não informa alíquota.",
    },
  ],
  readNext: ["certificado-digital-a1-o-que-e-quando-precisa", "simples-nacional-nfse-nacional-novembro-2026"],
};
