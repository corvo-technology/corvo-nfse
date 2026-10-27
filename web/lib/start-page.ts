import type { SeoLocale } from "@/lib/seo";

/** Copy for /[locale]/start. Free-plan wording comes from messages (FreeTrial) unchanged. */
export interface StartCopy {
  title: string;
  metaTitle: string;
  description: string;
  eyebrow: string;
  intro: string;
  stepsTitle: string;
  steps: { title: string; body: string; href?: string }[];
  snippetTitle: string;
  docsLabel: string;
  backToHome: string;
}

export const START_PATH = "/start";
export const SIGNUP_HREF = "/login?mode=signup";

export const START_SNIPPET = `export BASE_URL='https://api.corvo.tech/v1'
export CORVO_API_KEY='corvo_test_sua_chave'

curl -X POST "$BASE_URL/invoices" \\
  -H "X-API-Key: $CORVO_API_KEY" \\
  -H 'Content-Type: application/json' \\
  -H 'Idempotency-Key: pedido_123_emissao' \\
  -d '{
    "companyTaxId": "11222333000181",
    "externalId": "pedido_123",
    "customer": { "name": "Cliente Exemplo", "taxId": "52998224725" },
    "service": { "description": "Prestação de serviço" },
    "amount": 150.50
  }'`;

export const START_COPY: Record<SeoLocale, StartCopy> = {
  pt: {
    title: "Comece grátis: emita sua primeira NFS-e pela API",
    metaTitle: "Comece grátis — primeira NFS-e pela API",
    description:
      "Crie a conta, gere uma chave de teste, cadastre a empresa e emita a primeira NFS-e com POST /v1/invoices. Status por webhook.",
    eyebrow: "COMECE GRÁTIS",
    intro: "Do cadastro à primeira nota em quatro passos, no ambiente de teste.",
    stepsTitle: "Passo a passo",
    steps: [
      { title: "Crie a conta", body: "Cadastre-se com seu e-mail. Não é preciso cartão de crédito." },
      {
        title: "Gere uma chave de teste",
        body: "No painel, crie uma chave que começa com corvo_test_. Notas emitidas com ela não têm valor fiscal.",
        href: "/docs/authentication",
      },
      {
        title: "Cadastre a empresa",
        body: "Envie CNPJ, regime tributário e código do município com POST /v1/companies.",
        href: "/docs/companies",
      },
      {
        title: "Emita a nota e receba o webhook",
        body: "Chame POST /v1/invoices com um Idempotency-Key. A emissão é assíncrona: o resultado chega pelos webhooks nfse.invoice.authorized ou nfse.invoice.rejected.",
        href: "/docs/invoices",
      },
    ],
    snippetTitle: "Primeira nota com curl",
    docsLabel: "Ver a documentação",
    backToHome: "Voltar ao início",
  },
  en: {
    title: "Start free: issue your first NFS-e through the API",
    metaTitle: "Start free — your first NFS-e through the API",
    description:
      "Create an account, get a test key, register the company and issue your first NFS-e with POST /v1/invoices. Status by webhook.",
    eyebrow: "START FREE",
    intro: "From signup to your first invoice in four steps, in the test environment.",
    stepsTitle: "Step by step",
    steps: [
      { title: "Create an account", body: "Sign up with your email. No credit card required." },
      {
        title: "Create a test key",
        body: "In the dashboard, create a key starting with corvo_test_. Invoices issued with it have no fiscal value.",
        href: "/docs/authentication",
      },
      {
        title: "Register the company",
        body: "Send the CNPJ, tax regime and municipality code with POST /v1/companies.",
        href: "/docs/companies",
      },
      {
        title: "Issue the invoice and get the webhook",
        body: "Call POST /v1/invoices with an Idempotency-Key. Issuance is asynchronous: the result arrives through the nfse.invoice.authorized or nfse.invoice.rejected webhooks.",
        href: "/docs/invoices",
      },
    ],
    snippetTitle: "First invoice with curl",
    docsLabel: "Read the docs",
    backToHome: "Back to home",
  },
};
