import type { NfeSettings } from '@/modules/company/domain/nfe-settings';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { Decimal } from '@/shared/types/money';
import type { NfeAddress, NfeRecipient } from './nfe-document';
import type { NfeItemTax } from './nfe-item';
import type { NfeInput } from './nfe-input';
import { applyTaxDefaults, deriveIdDest } from './tax-defaults';
import {
  computeTotals,
  toCents,
  type NfeItemAmounts,
  type NfeTotals,
} from './totals';

/** The issuer as the XML needs it (company data plus its NF-e settings). */
export interface NfeIssuer {
  cnpj: string;
  legalName: string;
  tradeName: string | null;
  uf: string;
  /** IBGE code of the UF (cUF). */
  cUF: string;
  stateRegistration: string;
  crt: number | null;
  address: NfeAddress;
}

export interface NfeDraftItem {
  nItem: number;
  code: string;
  gtin: string | null;
  description: string;
  ncm: string;
  cest: string | null;
  cfop: string;
  unit: string;
  /** 4 decimals. */
  quantity: string;
  /** 10 decimals. */
  unitPrice: string;
  tax: NfeItemTax;
  amounts: NfeItemAmounts;
}

export interface NfeDraftPayment {
  tPag: string;
  cents: number;
}

/** A normalized request: what the validators check and the builder turns into XML. */
export interface NfeDraft {
  environment: ExecutionEnvironment;
  issuer: NfeIssuer;
  natOp: string;
  finNfe: number;
  tpImp: number;
  indPres: number;
  indFinal: number;
  idDest: 1 | 2;
  recipient: NfeRecipient;
  items: NfeDraftItem[];
  totals: NfeTotals;
  payments: NfeDraftPayment[];
  changeCents: number;
  additionalInfo: string | null;
  externalId: string | null;
  /** Whether the customer gets the documents by e-mail (default true). */
  sendEmail?: boolean;
}

const clean = (value: string): string => value.trim();
const orNull = (value: string | null | undefined): string | null => {
  const text = value?.trim();
  return text ? text : null;
};
const digits = (value: string): string => value.replace(/\D/g, '');
/** CPF/CNPJ without punctuation; the alphanumeric CNPJ keeps its letters. */
const taxIdOf = (value: string): string =>
  value.replace(/[.\s/-]/g, '').toUpperCase();

export function buildDraft(
  input: NfeInput,
  issuer: NfeIssuer,
  settings: Pick<
    NfeSettings,
    | 'defaultNatOp'
    | 'defaultOrigin'
    | 'defaultCsosn'
    | 'defaultPisCst'
    | 'defaultCofinsCst'
  >,
  environment: ExecutionEnvironment,
): NfeDraft {
  const address = input.recipient.address;
  const recipientUf = clean(address.state).toUpperCase();
  const indIeDest = input.recipient.indIeDest as 1 | 2 | 9;
  const taxes = applyTaxDefaults(input.items, settings);
  const totals = computeTotals(input.items);
  return {
    environment,
    issuer,
    natOp: clean(input.natOp ?? settings.defaultNatOp),
    finNfe: input.finNfe ?? 1,
    tpImp: input.tpImp ?? 1,
    indPres: 1,
    // A contributor buys for resale or use (0); anyone else is a final consumer (1).
    indFinal: indIeDest === 1 ? 0 : 1,
    idDest: deriveIdDest(issuer.uf, recipientUf),
    recipient: {
      taxId: taxIdOf(input.recipient.taxId),
      name: clean(input.recipient.name),
      indIeDest,
      stateRegistration: orNull(
        input.recipient.stateRegistration?.replace(/[.\s/-]/g, ''),
      ),
      email: orNull(input.recipient.email),
      address: {
        street: clean(address.street),
        number: clean(address.number),
        complement: orNull(address.complement),
        district: clean(address.district),
        zip: digits(address.zip),
        cityCode: clean(address.cityCode),
        city: clean(address.city),
        state: recipientUf,
      },
    },
    items: input.items.map((item, index) => ({
      nItem: index + 1,
      code: clean(item.code),
      gtin: orNull(item.gtin),
      description: clean(item.description),
      ncm: clean(item.ncm),
      cest: orNull(item.cest),
      cfop: clean(item.cfop),
      unit: clean(item.unit),
      quantity: new Decimal(item.quantity).toFixed(4),
      unitPrice: new Decimal(item.unitPrice).toFixed(10),
      tax: taxes[index],
      amounts: totals.items[index],
    })),
    totals,
    payments: input.payments.map((p) => ({
      tPag: clean(p.tPag),
      cents: toCents(p.amount),
    })),
    changeCents: toCents(input.change ?? 0),
    additionalInfo: orNull(input.additionalInfo),
    externalId: orNull(input.externalId),
    ...(input.sendEmail === false ? { sendEmail: false } : {}),
  };
}
