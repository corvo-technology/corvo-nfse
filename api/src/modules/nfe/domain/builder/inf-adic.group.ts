import type { BuildContext, XmlNode } from './context';

/** `infAdic`: the free text of the customer, or nothing. */
export function infAdicGroup(ctx: BuildContext): XmlNode | undefined {
  const { additionalInfo } = ctx.draft;
  return additionalInfo ? { infCpl: additionalInfo } : undefined;
}
