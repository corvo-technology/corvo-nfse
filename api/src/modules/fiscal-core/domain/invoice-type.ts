/** The kinds of document `/v1/invoices` serves: `nfse` (service) and `nfe` (goods, model 55). */
export const INVOICE_TYPES = ['nfse', 'nfe'] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];

/** The values of `type` in `GET /v1/invoices`: one kind, or both in a summary shape. */
export const INVOICE_LIST_TYPES = ['nfse', 'nfe', 'all'] as const;
export type InvoiceListType = (typeof INVOICE_LIST_TYPES)[number];
