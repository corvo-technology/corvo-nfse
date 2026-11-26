import type { PreSendValidator } from '@/modules/fiscal-core/application/emission-pipeline';
import type { NfeDraft } from '../nfe-draft';

const SUPPORTED = ['102', '400'];

export const csosnValidator: PreSendValidator<NfeDraft> = {
  name: 'csosn',
  validate(draft) {
    return draft.items.flatMap((item, index) =>
      SUPPORTED.includes(item.tax.csosn)
        ? []
        : [
            {
              field: `items[${index}].tax.csosn`,
              code: 'CSOSN_NOT_SUPPORTED',
              message: 'Only CSOSN 102 and 400 are supported',
            },
          ],
    );
  },
};
