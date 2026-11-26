import type { DocumentType } from './document-type';

export interface CreditPriceReader {
  /** Credits charged for one document of this type, read at the moment of the reservation. */
  priceOf(type: DocumentType): Promise<number>;
}

export const CREDIT_PRICE_READER = Symbol('CREDIT_PRICE_READER');
