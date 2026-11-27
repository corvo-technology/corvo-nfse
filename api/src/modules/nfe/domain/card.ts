import type { NfceCard } from './nfe-document';

const orNull = (value: string | null | undefined): string | null => {
  const text = value?.trim();
  return text ? text : null;
};
const taxIdOf = (value: string): string =>
  value.replace(/[.\s/-]/g, '').toUpperCase();

/**
 * Card brands (`tBand`) of the NT's table. The XSD only asks for 2 digits, so this is the finer
 * check of rejection 443 [não verificado: confirm the table of the current NT].
 */
export const CARD_BRANDS: readonly string[] = [
  '01',
  '02',
  '03',
  '04',
  '05',
  '06',
  '07',
  '08',
  '09',
  '10',
  '11',
  '12',
  '13',
  '14',
  '15',
  '16',
  '17',
  '18',
  '19',
  '20',
  '21',
  '22',
  '23',
  '24',
  '25',
  '26',
  '27',
  '99',
];

/**
 * `tPag` values that carry the `card` group (rejection 391 of the SEFAZ when it is missing): credit
 * (03), debit (04) and instant payment, PIX (17). Seen in the homologação of SP: tPag 03 and 17 without
 * the group are rejected with 391 [não verificado: 04 follows the NT; other electronic means are not asked].
 */
export const CARD_PAYMENT_TYPES: readonly string[] = ['03', '04', '17'];

/** The `card` group as stored; `{}` means "not integrated" (`tpIntegra` 2). */
export function cardOf(card: Partial<NfceCard>): NfceCard {
  return {
    tpIntegra: card.tpIntegra ?? 2,
    cnpj: orNull(taxIdOf(card.cnpj ?? '')),
    tBand: orNull(card.tBand),
    cAut: orNull(card.cAut),
  };
}

/** What goes in the `card` of a payment: the caller's, or the minimal one when the `tPag` demands it. */
export function paymentCard(
  tPag: string,
  card: Partial<NfceCard> | undefined,
): NfceCard | undefined {
  if (card) return cardOf(card);
  return CARD_PAYMENT_TYPES.includes(tPag) ? cardOf({}) : undefined;
}
