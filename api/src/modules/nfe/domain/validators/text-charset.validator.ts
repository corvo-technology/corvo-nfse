import type { PreSendValidator } from '@/modules/fiscal-core/application/emission-pipeline';
import type { ValidationIssue } from '@/modules/fiscal-core/domain/ports/tax-validator.port';
import type { NfeDraft } from '../nfe-draft';

/**
 * What the SEFAZ accepts in a text field: printable Latin-1 (space to ~, and NBSP to ÿ). Emoji,
 * line breaks and control characters would fail the XSD or be rejected with 225, so they are
 * reported here with the field instead.
 */
const ACCEPTED = /^[ -~ -ÿ]*$/;

export function isAcceptedText(value: string): boolean {
  return ACCEPTED.test(value);
}

export const textCharsetValidator: PreSendValidator<NfeDraft> = {
  name: 'text-charset',
  validate(draft) {
    const fields: Array<[string, string | null]> = [
      ['natOp', draft.natOp],
      ['recipient.name', draft.recipient.name],
      ['recipient.address.street', draft.recipient.address.street],
      ['recipient.address.number', draft.recipient.address.number],
      ['recipient.address.complement', draft.recipient.address.complement],
      ['recipient.address.district', draft.recipient.address.district],
      ['recipient.address.city', draft.recipient.address.city],
      ...draft.items.flatMap((item, index): Array<[string, string | null]> => [
        [`items[${index}].code`, item.code],
        [`items[${index}].description`, item.description],
        [`items[${index}].unit`, item.unit],
      ]),
      ['additionalInfo', draft.additionalInfo],
    ];
    const issues: ValidationIssue[] = [];
    for (const [field, value] of fields)
      if (value !== null && !isAcceptedText(value))
        issues.push({
          field,
          code: 'TEXT_CHARSET_INVALID',
          message:
            'Use only letters, digits and common punctuation (no emoji, line breaks or control characters)',
        });
    return issues;
  },
};
