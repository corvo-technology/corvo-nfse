import type { Invoice } from "./types";

/** The detail page of a note: NFS-e under /app/invoices, NF-e and NFC-e under /app/nfe. */
export const invoiceHref = (invoice: Pick<Invoice, "id" | "type">) => (invoice.type === "nfe" || invoice.type === "nfce" ? `/app/nfe/${invoice.id}` : `/app/invoices/${invoice.id}`);
