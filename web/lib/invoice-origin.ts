import type { Invoice } from "@/lib/types";

/** Where a note came from. Same rules as the API filter: read from the keys Corvo writes itself. */
export const INVOICE_ORIGINS = ["dashboard", "api", "integration", "schedule", "import"] as const;
export type InvoiceOriginKind = (typeof INVOICE_ORIGINS)[number];

export interface InvoiceOrigin {
  kind: InvoiceOriginKind;
  /** Integrations only: the platform the sale came from, when the reference tells. */
  provider?: "woovi" | "abacatepay" | "stripe" | "pushinpay" | "hotmart" | "kiwify" | "monetizze";
  /** Integrations only: the short id of the charge. */
  charge?: string;
}

/** The reference an integration writes is `<kind>:<id>`; `charge` is Woovi, `stripe_charge` Stripe, `pushinpay` PushinPay, `hotmart` Hotmart, `kiwify` Kiwify, `monetizze` Monetizze, the others AbacatePay. */
const PROVIDER_BY_REFERENCE: Record<string, "woovi" | "abacatepay" | "stripe" | "pushinpay" | "hotmart" | "kiwify" | "monetizze"> = { charge: "woovi", stripe_charge: "stripe", checkout: "abacatepay", transparent: "abacatepay", pushinpay: "pushinpay", hotmart: "hotmart", kiwify: "kiwify", monetizze: "monetizze" };

const shortId = (id: string) => (id.length > 12 ? id.slice(0, 8) : id);

export function invoiceOrigin(invoice: Pick<Invoice, "idempotencyKey" | "externalId">): InvoiceOrigin {
  const key = invoice.idempotencyKey ?? "";
  if (key.startsWith("integ_")) {
    const [prefix, ...rest] = (invoice.externalId ?? "").split(":");
    const provider = PROVIDER_BY_REFERENCE[prefix];
    const id = rest.join(":");
    return { kind: "integration", ...(provider ? { provider } : {}), ...(provider && id ? { charge: shortId(id) } : {}) };
  }
  if (key.startsWith("schedule:")) return { kind: "schedule" };
  if (key.startsWith("import:")) return { kind: "import" };
  if (invoice.externalId?.startsWith("dashboard-")) return { kind: "dashboard" };
  return { kind: "api" };
}

type OriginT = (key: string, values?: Record<string, string>) => string;

/** "Pix sale (Woovi) · charge 441d455e", "Dashboard", "API"... `t` is the `InvoiceOrigin` namespace. */
export function originText(origin: InvoiceOrigin, t: OriginT): string {
  if (origin.kind !== "integration") return t(`kind.${origin.kind}`);
  const base = origin.provider ? t(`integration.${origin.provider}`) : t("integration.generic");
  return origin.charge ? t("withCharge", { origin: base, charge: origin.charge }) : base;
}
