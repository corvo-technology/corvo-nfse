import type { PreSendValidator } from '@/modules/fiscal-core/application/emission-pipeline';
import type { ValidationIssue } from '@/modules/fiscal-core/domain/ports/tax-validator.port';
import type { NfeDraft } from '@/modules/nfe/domain/nfe-draft';

/** What the NFC-e does not do: other purposes than a normal sale, other UFs. (Transport is refused by the DTO.) */
export const nfceScopeValidator: PreSendValidator<NfeDraft> = {
  name: 'nfce-scope',
  validate(draft) {
    const issues: ValidationIssue[] = [];
    if (draft.finNfe !== 1)
      issues.push({
        field: 'finNfe',
        code: 'NFCE_SCOPE_NOT_SUPPORTED',
        message: 'Only the normal NFC-e (finNfe 1) is supported',
      });
    const state = draft.recipient?.address?.state;
    if (state && state !== draft.issuer.uf)
      issues.push({
        field: 'recipient.address.state',
        code: 'NFCE_SCOPE_NOT_SUPPORTED',
        message: 'The NFC-e is only for operations inside the issuer UF',
      });
    return issues;
  },
};
