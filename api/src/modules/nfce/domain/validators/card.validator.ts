import type { PreSendValidator } from '@/modules/fiscal-core/application/emission-pipeline';
import type { ValidationIssue } from '@/modules/fiscal-core/domain/ports/tax-validator.port';
import type { NfeDraft } from '@/modules/nfe/domain/nfe-draft';
import { isValidCnpj } from '@/shared/fiscal/cnpj';
import { CARD_BRANDS, CARD_PAYMENT_TYPES } from '../consumer-limits';

/** The `card` group (rejections 392, 437, 443) and where it may appear, plus the no-payment `tPag` 90. */
export const cardValidator: PreSendValidator<NfeDraft> = {
  name: 'nfce-card',
  validate(draft) {
    const issues: ValidationIssue[] = [];
    draft.payments.forEach((payment, index) => {
      const field = `payments[${index}].card`;
      if (payment.tPag === '90' && payment.cents !== 0)
        issues.push({
          field: `payments[${index}]`,
          code: 'NFCE_NO_PAYMENT_AMOUNT',
          message: 'A payment of type 90 (no payment) must have the value 0',
        });
      const { card } = payment;
      if (!card) return;
      if (!CARD_PAYMENT_TYPES.includes(payment.tPag))
        issues.push({
          field,
          code: 'NFCE_CARD_NOT_ALLOWED',
          message: 'Card data only goes with payment types 03, 04 and 17',
        });
      if (card.tpIntegra === 1 && (!card.cnpj || !card.cAut))
        issues.push({
          field,
          code: 'NFCE_CARD_DATA_REQUIRED',
          message:
            'An integrated payment (tpIntegra 1) needs the acquirer CNPJ and the authorization number',
        });
      if (card.cnpj && !isValidCnpj(card.cnpj))
        issues.push({
          field: `${field}.cnpj`,
          code: 'TAX_ID_INVALID',
          message: 'The acquirer CNPJ is not valid',
        });
      if (card.tBand && !CARD_BRANDS.includes(card.tBand))
        issues.push({
          field: `${field}.tBand`,
          code: 'NFCE_CARD_BRAND_INVALID',
          message: 'The card brand is not in the official table',
        });
    });
    return issues;
  },
};
