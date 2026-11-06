import type { DocBlock } from "./types";
import { INVOICE_REJECTION_CODES, REQUEST_ERRORS, VALIDATION_CODES } from "./error-catalog";
import pt from "../../messages/pt.json";
import en from "../../messages/en.json";

type Locale = "pt" | "en";
const texts = (locale: Locale): Record<string, string> => (locale === "pt" ? pt : en).ApiErrors;

const COPY = {
  pt: {
    heading: "Catálogo de códigos",
    intro: "Todos os códigos que a API devolve. O texto de cada um é o mesmo que o painel mostra ao usuário; a `message` da resposta continua em inglês. A decisão deve ser sempre pelo `code` e pelo status HTTP.",
    request: "Erros de requisição",
    requestIntro: "Campo `code` do corpo da resposta, sempre com o prefixo `ERROR_`.",
    validation: "Códigos de validação",
    validationIntro: "Campo `details[].code` quando o `code` é `ERROR_VALIDATION` (422) ou o corpo de um erro de campo. Também chegam com o prefixo `ERROR_`.",
    rejection: "Motivos de rejeição da nota",
    rejectionIntro: "Campo `lastErrorCode` de uma nota `rejected` ou `failed`. Rejeições da própria Receita/Sefin chegam com o código oficial (por exemplo `E0120`) e o texto da autoridade em `lastErrorMessage`.",
    head: ["code", "HTTP", "O que significa"],
    headNoStatus: ["code", "O que significa"],
  },
  en: {
    heading: "Code catalogue",
    intro: "Every code the API returns. Each text is the same the dashboard shows the user; the response `message` stays in English. Always decide by `code` and HTTP status.",
    request: "Request errors",
    requestIntro: "The `code` field of the response body, always prefixed with `ERROR_`.",
    validation: "Validation codes",
    validationIntro: "The `details[].code` field when `code` is `ERROR_VALIDATION` (422) or in a field error. They also arrive prefixed with `ERROR_`.",
    rejection: "Invoice rejection reasons",
    rejectionIntro: "The `lastErrorCode` of a `rejected` or `failed` invoice. Rejections from the Receita/Sefin themselves arrive with the official code (for example `E0120`) and the authority's text in `lastErrorMessage`.",
    head: ["code", "HTTP", "Meaning"],
    headNoStatus: ["code", "Meaning"],
  },
} as const;

const name = (code: string) => `\`ERROR_${code.toUpperCase()}\``;

/** The error catalogue of the docs, built from the same table the dashboard translates from. */
export function errorCatalogBlocks(locale: Locale): DocBlock[] {
  const t = texts(locale);
  const c = COPY[locale];
  const meaning = (code: string) => t[code] ?? "";
  return [
    { kind: "heading", level: 2, body: c.heading },
    { kind: "text", body: c.intro },
    { kind: "heading", level: 3, body: c.request },
    { kind: "text", body: c.requestIntro },
    { kind: "table", head: [...c.head], rows: REQUEST_ERRORS.map((entry) => [name(entry.code), String(entry.status ?? "-"), meaning(entry.code)]) },
    { kind: "heading", level: 3, body: c.validation },
    { kind: "text", body: c.validationIntro },
    { kind: "table", head: [...c.headNoStatus], rows: VALIDATION_CODES.map((code) => [name(code), meaning(code)]) },
    { kind: "heading", level: 3, body: c.rejection },
    { kind: "text", body: c.rejectionIntro },
    { kind: "table", head: [...c.headNoStatus], rows: INVOICE_REJECTION_CODES.map((code) => [`\`${code.toUpperCase()}\``, meaning(code)]) },
  ];
}
