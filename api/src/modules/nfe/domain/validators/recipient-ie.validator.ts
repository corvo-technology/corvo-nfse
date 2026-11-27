import type { PreSendValidator } from '@/modules/fiscal-core/application/emission-pipeline';
import type { NfeDraft } from '../nfe-draft';

/** indIEDest 1 needs the state registration; 2 (exempt) and 9 (non-contributor) must not carry one. */
export const recipientIeValidator: PreSendValidator<NfeDraft> = {
  name: 'recipient-ie',
  validate(draft) {
    if (!draft.recipient) return [];
    const { indIeDest, stateRegistration } = draft.recipient;
    const issue = (message: string) => [
      {
        field: 'recipient.stateRegistration',
        code: 'RECIPIENT_IE_INVALID',
        message,
      },
    ];
    if (![1, 2, 9].includes(indIeDest))
      return [
        {
          field: 'recipient.indIeDest',
          code: 'RECIPIENT_IE_INVALID',
          message: 'indIeDest must be 1, 2 or 9',
        },
      ];
    if (indIeDest === 1)
      return stateRegistration && /^\d{2,14}$/.test(stateRegistration)
        ? []
        : issue(
            'A contributor recipient (indIeDest 1) needs the state registration, digits only',
          );
    return stateRegistration
      ? issue(
          'Only a contributor recipient (indIeDest 1) has a state registration',
        )
      : [];
  },
};
