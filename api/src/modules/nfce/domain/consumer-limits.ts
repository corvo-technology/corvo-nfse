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

export { CARD_BRANDS, CARD_PAYMENT_TYPES } from '@/modules/nfe/domain/card';
