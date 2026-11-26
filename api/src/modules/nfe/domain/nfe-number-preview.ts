import type { NumberingScope } from '@/modules/fiscal-core/domain/ports/numbering.port';

/** Reads the number the next emission would get, without reserving it (the dry-run). */
export abstract class INfeNumberPreview {
  abstract peekNext(
    scope: NumberingScope,
  ): Promise<{ series: number; number: number }>;
}
