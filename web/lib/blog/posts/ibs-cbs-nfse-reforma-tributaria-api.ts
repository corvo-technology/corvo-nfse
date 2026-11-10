import type { BlogPost } from "../types";

export const post: BlogPost = {
  slug: "ibs-cbs-nfse-reforma-tributaria-api",
  title: "IBS e CBS na NFS-e: o que a API calcula antes de emitir",
  seoTitle: "IBS e CBS na NFS-e: o que a API calcula antes de emitir",
  description:
    "Como conferir ISS, retenções e IBS/CBS antes de emitir a NFS-e com POST /v1/invoices/calculate, o que o MEI e o Simples Nacional informam e quando a nota fica bloqueada.",
  publishedAt: "2026-11-10",
  updatedAt: "2026-11-10",
  cluster: "tributos",
  keywords: [
    "IBS CBS NFS-e",
    "reforma tributária NFS-e",
    "calcular tributos NFS-e",
    "NFS-e MEI IBS CBS",
    "ISS NFS-e Simples Nacional",
    "dedução base ISS",
  ],
  answer:
    "Antes de emitir, chame `POST /v1/invoices/calculate` com o mesmo corpo da nota: a API devolve ISS, retenções e, quando se aplicam, IBS e CBS, sem emitir e sem gastar crédito. Se faltar algum dado fiscal, a resposta traz `status: \"blocked\"` e a lista do que falta em `pendingFields`.",
  blocks: [
    {
      kind: "p",
      text: "A reforma tributária do consumo traz o **IBS** (Imposto sobre Bens e Serviços) e a **CBS** (Contribuição sobre Bens e Serviços) para dentro da nota fiscal de serviço, e 2026 é o ano de teste desse destaque. Para quem integra emissão, a pergunta prática não é a tese tributária, e sim: **o que muda no meu payload e como eu descubro isso antes de emitir?**",
    },
    {
      kind: "p",
      text: "Este guia mostra como usar o cálculo da Corvo para responder a essa pergunta nota a nota. Ele descreve o comportamento da API, não substitui a legislação nem a orientação do contador da empresa.",
    },
    {
      kind: "callout",
      tone: "warn",
      text: "As regras fiscais mudam durante a transição. O cálculo da Corvo informa a versão das regras aplicadas (`rulesVersion`) e as referências legais usadas (`legalReferences`) em cada resposta. Confira sempre esses campos e valide o enquadramento com a contabilidade.",
    },
    { kind: "h2", text: "Calcular sem emitir" },
    {
      kind: "p",
      text: "`POST /v1/invoices/calculate` recebe o mesmo corpo de `POST /v1/invoices` (empresa, `service`, `amount`, `competenceDate`, `customer` opcional, `discount`, `deduction`). Ele **não grava nota, não consome crédito, não reserva número de DPS, não agenda e não chama a Sefin**. Não exige certificado nem empresa pronta, então funciona desde o ambiente de teste.",
    },
    {
      kind: "code",
      label: "Calcular os tributos de um serviço",
      language: "bash",
      code: `curl -X POST "$BASE_URL/invoices/calculate" \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "companyTaxId": "11222333000181",
    "service": { "code": "060101", "description": "Corte de cabelo" },
    "amount": 50,
    "competenceDate": "2026-10-13"
  }'`,
    },
    { kind: "h2", text: "Como ler a resposta" },
    {
      kind: "p",
      text: "A resposta separa o que é **aplicável** do que é **calculado**. Valores e alíquotas vêm como strings decimais, por exemplo `\"50.00\"`.",
    },
    {
      kind: "table",
      head: ["Campo", "O que informa"],
      rows: [
        ["`status`", "`ready` quando o cálculo foi feito; `blocked` quando falta dado fiscal."],
        ["`applicability`", "Para ISS, retenção federal, IBS e CBS: se se aplica e o motivo."],
        ["`taxes` e `withholdings`", "Os tributos calculados e as retenções."],
        ["`netReceivableAmount`", "O valor líquido a receber."],
        ["`calculation`", "Origem do cálculo, `rulesVersion` e `legalReferences`."],
        ["`warnings` e `pendingFields`", "Avisos e os campos que ainda faltam."],
      ],
    },
    {
      kind: "callout",
      tone: "accent",
      text: "`ready` significa que os dados fiscais estão completos e o cálculo foi feito. É uma **estimativa pré-emissão**, não uma autorização da Sefin.",
    },
    { kind: "h2", text: "MEI e Simples Nacional: o que muda no seu cadastro" },
    {
      kind: "ul",
      items: [
        "**MEI:** não informa alíquota. O ISS é recolhido no DAS-MEI e, na fase de teste de 2026, o MEI não destaca IBS/CBS. A resposta do cálculo registra isso no `applicability`, com o motivo.",
        "**ME/EPP do Simples Nacional:** informa a alíquota efetiva total do próprio DAS (a do PGDAS-D) em `simplesRate` ao cadastrar a empresa, por exemplo `\"6.54\"`. Esse valor vai em toda nota. A Corvo não calcula o DAS.",
        "**Perfis de serviço:** quando o regime pede IBS/CBS ou ISS configurado, a empresa precisa de um perfil de classificação do serviço (`/v1/companies/:id/service-tax-profiles`). Sem ele, o cálculo volta bloqueado.",
      ],
    },
    { kind: "h2", text: "Quando a resposta vem bloqueada" },
    {
      kind: "p",
      text: "Problema fiscal **não é erro HTTP**. O cálculo volta `200` com `status: \"blocked\"`, um objeto `blocking` (`code`, `message`, `step`) e `pendingFields[]` com o que falta. Os valores já calculados antes do bloqueio permanecem na resposta. Dois códigos comuns:",
    },
    {
      kind: "table",
      head: ["Código", "Significa"],
      rows: [
        ["`FISCAL_CLASSIFICATION_REQUIRED`", "Falta a classificação fiscal do serviço (perfil de serviço)."],
        ["`TAX_RATE_NOT_FOUND`", "Não foi encontrada a alíquota para a combinação informada."],
      ],
    },
    {
      kind: "p",
      text: "Erros de entrada seguem o envelope normal da API: `404` para empresa inexistente e `422` para campo inválido. Se a calculadora de tributos estiver indisponível, a resposta é `503` com `Retry-After`; tente de novo depois, em vez de estimar por conta própria.",
    },
    { kind: "h2", text: "Dedução da base do ISS" },
    {
      kind: "p",
      text: "O campo opcional `deduction` (em reais) declara uma dedução da base de cálculo do ISS. Ele precisa ser maior que 0 e menor que `amount` menos `discount`, com no máximo duas casas decimais. A nota continua sendo emitida pelo valor total, e quem declara responde pelo valor: a Corvo não confere se aquela dedução é permitida. Dois detalhes que costumam surpreender:",
    },
    {
      kind: "ul",
      items: [
        "O **IBS/CBS segue calculado sobre o valor sem a dedução**.",
        "As retenções federais **não** são reduzidas pela dedução.",
      ],
    },
    {
      kind: "p",
      text: "Regimes que não podem declarar dedução recebem `ERROR_VALIDATION` com o código `ERROR_DEDUCTION_NOT_ALLOWED_FOR_REGIME` em `details[].code`. O mesmo vale para o Simples acima do sublimite, que ainda não é suportado (`ERROR_SIMPLES_SUBLIMIT_NOT_SUPPORTED`).",
    },
    { kind: "h2", text: "Onde encaixar o cálculo no seu fluxo" },
    {
      kind: "ol",
      items: [
        "**Na tela de checkout ou no orçamento:** chame `calculate` para mostrar o valor líquido antes de o cliente confirmar.",
        "**No cadastro da empresa:** rode um `calculate` de exemplo para detectar perfil de serviço faltando antes da primeira emissão real.",
        "**Antes de cada emissão em lote:** valide uma amostra para evitar um lote inteiro rejeitado pelo mesmo motivo.",
        "**Depois de atualizar regras ou alíquotas:** compare `rulesVersion` com a que você guardou na última conferência.",
      ],
    },
    {
      kind: "p",
      text: "Com o cálculo conferido, a emissão em si segue o fluxo assíncrono descrito em [Emissão assíncrona de NFS-e: idempotência e webhooks](/pt/blog/emissao-assincrona-nfse-idempotencia-webhooks). A referência completa do endpoint está em [Notas fiscais](/pt/docs/invoices).",
    },
  ],
  faq: [
    {
      q: "O cálculo de tributos consome crédito?",
      a: "Não. `POST /v1/invoices/calculate` não grava nota, não consome crédito, não reserva número de DPS e não chama a Sefin.",
    },
    {
      q: "O MEI precisa destacar IBS e CBS na NFS-e?",
      a: "Pelas regras que a Corvo aplica na fase de teste de 2026, o MEI não destaca IBS/CBS, e a resposta do cálculo registra isso em `applicability` com o motivo. Como as regras estão em transição, confirme com a contabilidade e acompanhe `rulesVersion`.",
    },
    {
      q: "O que significa status blocked no cálculo?",
      a: "Que falta algum dado fiscal. A resposta volta `200` com `blocking` e `pendingFields` indicando o que corrigir, por exemplo o perfil de serviço (`FISCAL_CLASSIFICATION_REQUIRED`). Não é erro HTTP.",
    },
    {
      q: "A Corvo calcula o DAS do Simples Nacional?",
      a: "Não. A ME/EPP informa a própria alíquota efetiva total em `simplesRate` ao cadastrar a empresa, e esse valor vai em toda nota. A Corvo não gera o DAS.",
    },
    {
      q: "O resultado do cálculo vale como autorização da nota?",
      a: "Não. É uma estimativa pré-emissão. A autorização vem da Sefin depois da emissão, quando a nota chega a `authorized`.",
    },
  ],
  readNext: ["api-de-nfse-emitir-nota-fiscal-de-servico", "emissao-assincrona-nfse-idempotencia-webhooks"],
};
