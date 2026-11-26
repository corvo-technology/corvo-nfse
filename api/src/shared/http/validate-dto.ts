import type { Type } from '@nestjs/common';
import { createValidationPipe } from './validation-pipe';

const pipe = createValidationPipe();

/**
 * Validates a plain object the way the global pipe validates a DTO parameter (same rules, same
 * 400 answer). For routes whose DTO depends on something the global pipe cannot see, like the
 * `type` of the document.
 */
export function validateDto<T extends object>(
  dto: Type<T>,
  value: unknown,
  kind: 'body' | 'query' = 'body',
): Promise<T> {
  return Promise.resolve(
    pipe.transform(value, { type: kind, metatype: dto }) as Promise<T>,
  );
}
