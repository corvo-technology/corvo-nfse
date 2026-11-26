import { centsToString } from '../totals';
import type { BuildContext, XmlNode } from './context';

/** `pag`: one `detPag` per payment and `vTroco` when there is change. */
export function pagGroup(ctx: BuildContext): XmlNode {
  const { payments, changeCents } = ctx.draft;
  return {
    detPag: payments.map((p) => ({
      tPag: p.tPag,
      vPag: centsToString(p.cents),
    })),
    vTroco: changeCents > 0 ? centsToString(changeCents) : undefined,
  };
}
