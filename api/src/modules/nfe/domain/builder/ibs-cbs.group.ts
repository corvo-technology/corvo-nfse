import type { BuildContext, XmlNode } from './context';

/**
 * Date (`YYYY-MM-DD`) from which the SEFAZ requires the IBS/CBS group in the NF-e. Absent (null)
 * means "not required yet", which is the case while no NT sets the date; when it does, the date is
 * set here and the group below gets its content. [verificar: docs/fiscal/fiscal-dates.json]
 */
export const NFE_IBS_CBS_REQUIRED_FROM: string | null = null;

export class NfeIbsCbsNotSupportedError extends Error {
  constructor() {
    super('The IBS/CBS group is required from this date but not supported yet');
    this.name = 'NfeIbsCbsNotSupportedError';
  }
}

/** `dhEmi` is in the issuer's civil time, so its first 10 characters are the issue date. */
export function ibsCbsRequired(
  dhEmi: string,
  from: string | null = NFE_IBS_CBS_REQUIRED_FROM,
): boolean {
  return from !== null && dhEmi.slice(0, 10) >= from;
}

/** `IBSCBS` is emitted only when required; until it is implemented, requiring it is an error. */
export function ibsCbsGroup(
  ctx: BuildContext,
  from: string | null = NFE_IBS_CBS_REQUIRED_FROM,
): XmlNode | undefined {
  if (!ibsCbsRequired(ctx.dhEmi, from)) return undefined;
  throw new NfeIbsCbsNotSupportedError();
}
