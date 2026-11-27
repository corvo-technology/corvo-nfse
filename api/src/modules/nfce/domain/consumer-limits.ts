import type { Uf } from '@/modules/fiscal-core/domain/ports/authority.port';

/**
 * Sale total, in cents, from which the NFC-e needs the consumer's CPF/CNPJ. Per UF; a UF not listed
 * uses the default of R$ 10.000,00 [não verificado por UF: the table is empty on purpose and each
 * UF enters with its official source].
 */
export const CONSUMER_ID_LIMIT_CENTS: Partial<Record<Uf, number>> = {};

export const DEFAULT_CONSUMER_ID_LIMIT_CENTS = 1_000_000;

export function consumerIdLimitCents(uf: string): number {
  return CONSUMER_ID_LIMIT_CENTS[uf as Uf] ?? DEFAULT_CONSUMER_ID_LIMIT_CENTS;
}

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

/** `tPag` values that may carry the `card` group: credit, debit and instant payment (PIX). */
export const CARD_PAYMENT_TYPES: readonly string[] = ['03', '04', '17'];
