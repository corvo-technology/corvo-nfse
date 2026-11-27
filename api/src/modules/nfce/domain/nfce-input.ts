import type { NfceCard } from '@/modules/nfe/domain/nfe-document';
import type {
  NfeAddressInput,
  NfeItemInput,
  NfePaymentInput,
} from '@/modules/nfe/domain/nfe-input';

export type { NfceCard };

/** The consumer of a NFC-e: every field is optional (a sale may be anonymous). */
export interface NfceRecipientInput {
  taxId?: string;
  name?: string;
  email?: string;
  address?: NfeAddressInput;
}

/** The same payment as the NF-e: `card` (`{}` means "not integrated", `tpIntegra` 2) is optional. */
export type NfcePaymentInput = NfePaymentInput;

/**
 * What the customer sends to `POST /v1/invoices` (`type: "nfce"`) and `POST /v1/invoices/validate`,
 * already parsed by the DTO (camelCase). Money and quantities arrive as JSON numbers. There is no
 * `natOp`, transport or `finNfe`: the NFC-e is always a normal sale to the final consumer.
 */
export interface NfceInput {
  companyId: string;
  recipient?: NfceRecipientInput;
  /** 1 in person (default), 4 delivery, 5 in an establishment but not the issuer's. */
  indPres?: 1 | 4 | 5;
  items: NfeItemInput[];
  payments: NfcePaymentInput[];
  change?: number;
  additionalInfo?: string;
  externalId?: string;
  /** Send the NFC-e to the consumer's e-mail once it is authorized (default true). */
  sendEmail?: boolean;
  /** `offline`: issue in contingency (`tpEmis` 9) and transmit later. Left out, the company option decides. */
  contingency?: 'offline';
}
