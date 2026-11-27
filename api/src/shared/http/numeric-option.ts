import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsIn } from 'class-validator';

/** "9" and " 9 " become 9; anything else (including a real number) goes through untouched. */
function toNumber(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : value;
}

/**
 * A small numeric code (`indIeDest`, `finNfe`, `tpImp`...) that clients send as `9` or as `"9"`:
 * the text is turned into the number before the check, so the rest of the API only sees numbers.
 */
export function NumericOption(field: string, options: readonly number[]) {
  const list = options.join(', ');
  return applyDecorators(
    Transform(({ value }) => toNumber(value)),
    IsIn(options, {
      message: `${field} must be one of ${list}, as a number or text (e.g. ${options[0]} or "${options[0]}"); received: $value`,
    }),
  );
}
