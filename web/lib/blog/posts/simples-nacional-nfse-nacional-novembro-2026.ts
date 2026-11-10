import type { BlogPost } from "../types";

export const post: BlogPost = {
  slug: "simples-nacional-nfse-nacional-novembro-2026",
  title: "Nota fiscal de serviço do Simples Nacional: o que mudou em 1º de novembro de 2026",
  seoTitle: "NFS-e do Simples Nacional: o que mudou em novembro de 2026",
  description:
    "Desde 1º de novembro de 2026, ME e EPP do Simples Nacional emitem a NFS-e no padrão nacional. Entenda o que isso significa e o que fazer agora.",
  publishedAt: "2026-11-10",
  updatedAt: "2026-11-10",
  cluster: "regras",
  keywords: [
    "NFS-e Simples Nacional",
    "NFS-e nacional obrigatória",
    "Resolução CGSN 191/2026",
    "nota fiscal de serviço ME EPP",
    "emissor nacional Simples Nacional",
    "NFS-e novembro 2026",
  ],
  answer:
    "Desde 1º de novembro de 2026, microempresas (ME) e empresas de pequeno porte (EPP) do Simples Nacional devem emitir a nota fiscal de serviço no padrão nacional, conforme a Resolução CGSN nº 191/2026. Na prática: confira como você emite hoje, converse com o contador e escolha como emitir no sistema nacional.",
  blocks: [
    {
      kind: "p",
      text: "Se a sua empresa é do Simples Nacional e emite nota de serviço pelo site da prefeitura, esse aviso é para você: a forma de emitir mudou. Aqui vai o que aconteceu, sem juridiquês, e o que você precisa fazer.",
    },
    { kind: "h2", text: "O que mudou" },
    {
      kind: "p",
      text: "A **NFS-e padrão nacional** é a nota de serviço emitida no sistema único do governo (o Emissor Nacional), em vez de no sistema de cada prefeitura. Para as empresas do Simples Nacional que são **ME ou EPP**, esse caminho passou a ser obrigatório em **1º de novembro de 2026**.",
    },
    {
      kind: "p",
      text: "Se você é **MEI**, nada de novo: o MEI já emitia no padrão nacional desde 1º de setembro de 2023, quando presta serviço a outra empresa. Veja o básico em [Como emitir nota fiscal de serviço](/pt/blog/como-emitir-nota-fiscal-de-servico-nfse).",
    },
    { kind: "h2", text: "A data mudou durante o ano" },
    {
      kind: "p",
      text: "Se você ouviu falar de **setembro**, não errou: a Resolução CGSN nº 189/2026 previa essa data. Depois, a Resolução CGSN nº 191/2026, de 4 de agosto de 2026, a substituiu e fixou **1º de novembro**. A [Fenacon](https://fenacon.org.br/noticias/simples-nacional-nfs-e-nacional-sera-obrigatoria-para-me-e-epp-a-partir-de-1o-de-novembro-de-2026/) resume a mudança.",
    },
    {
      kind: "callout",
      tone: "warn",
      text: "Alguns textos antigos na internet ainda citam setembro. Na dúvida, confirme a data e a sua situação com o contador. Este guia explica a regra; ele não substitui a orientação de quem cuida da contabilidade da sua empresa.",
    },
    { kind: "h2", text: "O que fazer agora" },
    {
      kind: "ol",
      items: [
        "**Confirme que sua empresa é ME ou EPP optante do Simples Nacional.** Seu contador ou o seu comprovante de opção mostra isso.",
        "**Veja como você emite hoje.** Se é pelo site da prefeitura, vale perguntar ao contador como a sua cidade ficou com a mudança.",
        "**Escolha como emitir no sistema nacional:** pelo portal do governo, pelo contador ou por um emissor como a Corvo.",
        "**Teste antes de emitir de verdade.** Na Corvo, o ambiente de teste é grátis e não tem valor fiscal.",
        "**Separe o certificado digital A1 da empresa**, se for emitir por um emissor. O [guia do certificado A1](/pt/blog/certificado-digital-a1-o-que-e-quando-precisa) explica o que é.",
      ],
    },
    { kind: "h2", text: "Como a Corvo ajuda" },
    {
      kind: "p",
      text: "A Corvo emite a NFS-e no padrão nacional para empresas **MEI e do Simples Nacional**. Para a ME e a EPP, o cadastro tem uma particularidade: você informa a **alíquota efetiva** do Simples Nacional da empresa, o número que aparece no extrato do PGDAS-D e que o seu contador conhece. Ela vai em todas as notas, e a Corvo calcula os tributos antes de emitir.",
    },
    {
      kind: "p",
      text: "Antes de começar, confira se o seu município está coberto na [página de cobertura por município](/pt/docs/municipalities). A Corvo **não** gera a guia do DAS.",
    },
    { kind: "h2", text: "Se a nota der problema" },
    {
      kind: "p",
      text: "Se uma nota não for autorizada, ela fica com o status **rejeitada** ou **em revisão**, e você vê isso no painel. Não adianta reemitir sem entender o motivo: corrija o que o painel indicar, ou fale com o suporte. Emitir de novo às cegas pode gerar duas notas para o mesmo serviço.",
    },
  ],
  faq: [
    {
      q: "A partir de quando a NFS-e nacional é obrigatória para o Simples Nacional?",
      a: "Para microempresas (ME) e empresas de pequeno porte (EPP) do Simples Nacional, desde 1º de novembro de 2026, pela Resolução CGSN nº 191/2026. Confirme a sua situação com o contador.",
    },
    {
      q: "O MEI também mudou em novembro de 2026?",
      a: "Não. O MEI já emitia no padrão nacional desde 1º de setembro de 2023, quando presta serviço a outra empresa. Para cliente pessoa física, a nota segue opcional.",
    },
    {
      q: "Preciso trocar de sistema?",
      a: "Depende de onde você emite hoje. Se emite pelo site da prefeitura, a emissão agora é no sistema nacional, pelo portal do governo, pelo contador ou por um emissor como a Corvo.",
    },
    {
      q: "A Corvo atende empresas do Simples Nacional?",
      a: "Sim. A Corvo emite NFS-e para MEI e para empresas do Simples Nacional. Ela não atende outros regimes e não emite nota de produto.",
    },
    {
      q: "Quem informa a alíquota do Simples Nacional?",
      a: "A ME ou a EPP informa a alíquota efetiva uma vez, ao cadastrar a empresa. É o número do extrato do PGDAS-D, que o contador conhece. O MEI não informa alíquota.",
    },
  ],
  readNext: ["como-emitir-nota-fiscal-de-servico-nfse", "certificado-digital-a1-o-que-e-quando-precisa"],
};
