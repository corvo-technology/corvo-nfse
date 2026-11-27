/**
 * The kinds of document `/v1/invoices` serves: `nfse` (service), `nfe` (goods, model 55) and
 * `nfce` (consumer sale, model 65).
 */
export const INVOICE_TYPES = ['nfse', 'nfe', 'nfce'] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];

/** The values of `type` in `GET /v1/invoices`: one kind, or all in a summary shape. */
export const INVOICE_LIST_TYPES = ['nfse', 'nfe', 'nfce', 'all'] as const;
export type InvoiceListType = (typeof INVOICE_LIST_TYPES)[number];
