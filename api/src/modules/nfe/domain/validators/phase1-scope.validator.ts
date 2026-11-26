import type { PreSendValidator } from '@/modules/fiscal-core/application/emission-pipeline';
import type { ValidationIssue } from '@/modules/fiscal-core/domain/ports/tax-validator.port';
import type { NfeDraft } from '../nfe-draft';

/** Phase 1 issues only normal NF-e (finNFe 1) for Simples Nacional (CRT 1) and MEI (CRT 4). */
export const phase1ScopeValidator: PreSendValidator<NfeDraft> = {
  name: 'phase1-scope',
  validate(draft) {
    const issues: ValidationIssue[] = [];
    if (draft.finNfe !== 1)
      issues.push({
        field: 'finNfe',
        code: 'OUT_OF_PHASE1_SCOPE',
        message: 'Only the normal NF-e (finNfe 1) is supported',
      });
    if (draft.issuer.crt !== 1 && draft.issuer.crt !== 4)
      issues.push({
        field: 'company.crt',
        code: 'OUT_OF_PHASE1_SCOPE',
        message: 'Only Simples Nacional (CRT 1) and MEI (CRT 4) are supported',
      });
    return issues;
  },
};
