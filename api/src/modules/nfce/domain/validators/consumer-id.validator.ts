import type { PreSendValidator } from '@/modules/fiscal-core/application/emission-pipeline';
import type { NfeDraft } from '@/modules/nfe/domain/nfe-draft';
import { consumerIdLimitCents } from '../consumer-limits';

/** From the UF limit (in cents, so R$ 9.999,99 passes and R$ 10.000,00 does not) the CPF/CNPJ is required. */
export const consumerIdValidator: PreSendValidator<NfeDraft> = {
  name: 'nfce-consumer-id',
  validate(draft) {
    if (draft.recipient?.taxId) return [];
    return draft.totals.vNF >= consumerIdLimitCents(draft.issuer.uf)
      ? [
          {
            field: 'recipient.taxId',
            code: 'NFCE_CONSUMER_ID_REQUIRED',
            message:
              'This sale total needs the consumer CPF or CNPJ on the NFC-e',
          },
        ]
      : [];
  },
};
