import type { NfceCard } from './nfe-document';

/**
 * What the customer sends to `POST /v1/invoices` (`type: "nfe"`) and `POST /v1/invoices/validate`, already parsed by the
 * DTO (camelCase). Money and quantities arrive as JSON numbers and are read with `Decimal` from
 * their shortest text form, never through float arithmetic.
 */
export interface NfeAddressInput {
  street: string;
  number: string;
  complement?: string | null;
  district: string;
  zip: string;
  cityCode: string;
  city: string;
  state: string;
}

export interface NfeRecipientInput {
  taxId: string;
  name: string;
  indIeDest: number;
  stateRegistration?: string | null;
  email?: string | null;
  address: NfeAddressInput;
}

export interface NfeItemTaxInput {
  origin?: number;
  csosn?: string;
  pisCst?: string;
  cofinsCst?: string;
}

export interface NfeItemInput {
  code: string;
  gtin?: string | null;
  description: string;
  ncm: string;
  cest?: string | null;
  cfop: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  freight?: number;
  insurance?: number;
  other?: number;
  tax?: NfeItemTaxInput;
}

export interface NfePaymentInput {
  tPag: string;
  amount: number;
  /** Cards, PIX and other electronic payments; left out, `tPag` 03, 04 and 17 get `tpIntegra` 2. */
  card?: Partial<NfceCard>;
}

export interface NfeInput {
  companyId: string;
  natOp?: string;
  finNfe?: number;
  tpImp?: number;
  recipient: NfeRecipientInput;
  items: NfeItemInput[];
  payments: NfePaymentInput[];
  change?: number;
  additionalInfo?: string;
  externalId?: string;
  /** Send the NF-e to the recipient's e-mail once it is authorized (default true). */
  sendEmail?: boolean;
}
