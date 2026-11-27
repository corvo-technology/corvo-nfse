import type { PreSendValidator } from '@/modules/fiscal-core/application/emission-pipeline';
import type { ValidationIssue } from '@/modules/fiscal-core/domain/ports/tax-validator.port';
import type { NfeDraft } from '../nfe-draft';

/**
 * What the SEFAZ accepts in a text field: printable Latin-1 (space to ~, and NBSP to ÿ). Emoji,
 * line breaks and control characters would fail the XSD or be rejected with 225, so they are
 * reported here with the field instead.
 */
const ACCEPTED = new RegExp('^[\\x20-\\x7E\\xA0-\\xFF]*$');

export function isAcceptedText(value: string): boolean {
  return ACCEPTED.test(value);
}

function recipientFields(draft: NfeDraft): Array<[string, string | null]> {
  const { recipient } = draft;
  if (!recipient) return [];
  const { address } = recipient;
  return [
    ['recipient.name', recipient.name],
    ...(address
      ? ([
          ['recipient.address.street', address.street],
          ['recipient.address.number', address.number],
          ['recipient.address.complement', address.complement],
          ['recipient.address.district', address.district],
          ['recipient.address.city', address.city],
        ] as Array<[string, string | null]>)
      : []),
  ];
}

export const textCharsetValidator: PreSendValidator<NfeDraft> = {
  name: 'text-charset',
  validate(draft) {
    const fields: Array<[string, string | null]> = [
      ['natOp', draft.natOp],
      ...recipientFields(draft),
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
