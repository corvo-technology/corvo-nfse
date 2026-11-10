import type { BlogPost } from "../types";

export const post: BlogPost = {
  slug: "certificado-digital-a1-o-que-e-quando-precisa",
  title: "Certificado digital A1: o que é, quando você precisa e como guardar com segurança",
  seoTitle: "Certificado digital A1: o que é e quando você precisa",
  description:
    "O que é o certificado digital A1 da empresa, quando ele é necessário para emitir nota fiscal de serviço e como enviá-lo e guardá-lo com segurança.",
  publishedAt: "2026-11-10",
  updatedAt: "2026-11-10",
  cluster: "basico",
  keywords: [
    "certificado digital A1",
    "certificado A1 nota fiscal",
    "certificado digital MEI",
    "e-CNPJ A1",
    "certificado A1 NFS-e",
    "para que serve certificado digital",
  ],
  answer:
    "O certificado digital A1 é um arquivo que funciona como o “RG digital” do CNPJ da empresa. Para emitir nota pelo portal do governo, o MEI não precisa dele: basta a conta gov.br em nível prata ou ouro. Para emitir notas de verdade por um emissor como a Corvo, o A1 da empresa é necessário. Nos testes, não.",
  blocks: [
    {
      kind: "p",
      text: "“Certificado digital” é uma das expressões que mais assustam quem só quer emitir uma nota. A boa notícia: o conceito é simples e, na maioria dos casos, você faz isso uma vez por ano.",
    },
    { kind: "h2", text: "O que é o certificado A1" },
    {
      kind: "p",
      text: "É um **arquivo** (normalmente com final `.pfx` ou `.p12`) que prova que quem está emitindo a nota é mesmo a empresa. Funciona como o RG digital do CNPJ: ele assina a nota em nome da empresa.",
    },
    {
      kind: "p",
      text: "Ele é vendido por uma autoridade certificadora credenciada e tem **prazo de validade**, geralmente de um ano. Depois disso, é preciso renovar. Existe também o certificado A3, que fica em um cartão ou token; para emitir por um sistema, o que vale é o A1, que é o arquivo.",
    },
    { kind: "h2", text: "Quando você precisa dele" },
    {
      kind: "table",
      head: ["Situação", "Precisa do A1?"],
      rows: [
        [
          "MEI emitindo no portal do governo",
          "Não. Entra com a conta gov.br em nível prata ou ouro, ligada ao CNPJ.",
        ],
        [
          "Emitindo notas de verdade pela Corvo",
          "Sim. O A1 do CNPJ da empresa é necessário para assinar as notas.",
        ],
        ["Testando na Corvo", "Não. O ambiente de teste não usa certificado e as notas não têm valor fiscal."],
      ],
    },
    {
      kind: "callout",
      tone: "accent",
      text: "Para o portal do governo, as regras de acesso podem mudar. Confira na [página oficial da NFS-e](https://www.gov.br/pt-br/servicos/emitir-nota-fiscal-de-servico-eletronica) e com o seu contador.",
    },
    { kind: "h2", text: "Como enviar o certificado para a Corvo" },
    {
      kind: "ol",
      items: [
        "Tenha o arquivo do certificado A1 da empresa e a **senha** dele, que você definiu na compra.",
        "Entre no painel da Corvo e abra a página da empresa que vai emitir.",
        "Clique em **Enviar certificado**, escolha o arquivo (.p12 ou .pfx, de até 50 KB) e informe a senha. A senha é usada só nesse envio.",
        "Pronto: a empresa fica apta a emitir notas reais.",
      ],
    },
    {
      kind: "p",
      text: "Se ainda não tem a empresa cadastrada, comece pelo [guia de como emitir nota fiscal de serviço](/pt/blog/como-emitir-nota-fiscal-de-servico-nfse).",
    },
    { kind: "h2", text: "Como guardar com segurança" },
    {
      kind: "p",
      text: "O certificado é a assinatura da sua empresa. Quem tem o arquivo e a senha pode assinar em seu nome. Por isso:",
    },
    {
      kind: "ul",
      items: [
        "**Não mande o certificado por WhatsApp, e-mail ou chat.** Envie somente pelo painel de quem vai usá-lo.",
        "**Não compartilhe a senha** junto com o arquivo.",
        "**Guarde uma cópia** em um lugar seguro, como o gerenciador de senhas ou um disco protegido.",
        "**Anote a data de validade** e renove antes de vencer, para não ficar sem poder emitir.",
        "**Nunca cole o arquivo ou a senha em conversa com assistente de IA.**",
      ],
    },
    {
      kind: "p",
      text: "Na Corvo, o certificado fica **criptografado**. Mesmo assim, o cuidado é seu na hora de enviar e guardar.",
    },
    { kind: "h2", text: "Meu certificado venceu. E agora?" },
    {
      kind: "p",
      text: "Compre ou renove o certificado A1 com a autoridade certificadora e envie o novo arquivo pelo painel. Enquanto o certificado estiver vencido, a empresa não consegue emitir notas reais. O ambiente de teste continua funcionando.",
    },
  ],
  faq: [
    {
      q: "O que é certificado digital A1?",
      a: "É um arquivo que funciona como o RG digital do CNPJ da empresa e assina as notas em nome dela. Costuma ter final .pfx ou .p12 e validade de cerca de um ano.",
    },
    {
      q: "O MEI precisa de certificado digital para emitir nota de serviço?",
      a: "No portal do governo, não: basta a conta gov.br em nível prata ou ouro. Para emitir notas reais por um emissor como a Corvo, a empresa precisa do certificado A1.",
    },
    {
      q: "Preciso do certificado para testar a Corvo?",
      a: "Não. O ambiente de teste não usa certificado, é grátis e as notas não têm valor fiscal. Você só precisa do A1 para emitir notas de verdade.",
    },
    {
      q: "Posso mandar o certificado por e-mail ou WhatsApp?",
      a: "Não é recomendado. Quem tem o arquivo e a senha pode assinar em nome da empresa. Envie apenas pelo painel de quem vai usar o certificado e não compartilhe a senha.",
    },
    {
      q: "O que acontece quando o certificado vence?",
      a: "A empresa fica sem poder emitir notas reais até você enviar um certificado novo. Renove antes do vencimento e envie o novo arquivo pelo painel.",
    },
  ],
  readNext: ["como-emitir-nota-fiscal-de-servico-nfse", "simples-nacional-nfse-nacional-novembro-2026"],
};
