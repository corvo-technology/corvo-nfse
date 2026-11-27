import type { PreSendValidator } from '@/modules/fiscal-core/application/emission-pipeline';
import type { NfeDraft } from '../nfe-draft';

/** Payments minus change must equal vNF, compared in whole cents. */
export const paymentsTotalValidator: PreSendValidator<NfeDraft> = {
  name: 'payments-total',
  validate(draft) {
    const paid = draft.payments.reduce((sum, p) => sum + p.cents, 0);
    return paid - draft.changeCents === draft.totals.vNF
      ? []
      : [
          {
            field: 'payments',
            code: 'PAYMENTS_TOTAL_MISMATCH',
            message:
              'The payments minus the change must equal the invoice total',
          },
        ];
  },
};
