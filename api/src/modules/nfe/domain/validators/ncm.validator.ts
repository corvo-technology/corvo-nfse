import type { PreSendValidator } from '@/modules/fiscal-core/application/emission-pipeline';
import type { NfeDraft } from '../nfe-draft';

export const ncmValidator: PreSendValidator<NfeDraft> = {
  name: 'ncm',
  validate(draft) {
    return draft.items.flatMap((item, index) =>
      /^\d{8}$/.test(item.ncm)
        ? []
        : [
            {
              field: `items[${index}].ncm`,
              code: 'NCM_INVALID',
              message: 'The NCM must have 8 digits',
            },
          ],
    );
  },
};
