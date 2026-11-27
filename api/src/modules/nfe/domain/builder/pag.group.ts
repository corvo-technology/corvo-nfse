import { centsToString } from '../totals';
import type { NfeDraftPayment } from '../nfe-draft';
import type { BuildContext, XmlNode } from './context';

/** `card`, in the order of the layout: `tpIntegra`, `CNPJ`, `tBand`, `cAut`. */
function cardNode(card: NonNullable<NfeDraftPayment['card']>): XmlNode {
  return {
    tpIntegra: card.tpIntegra,
    CNPJ: card.cnpj ?? undefined,
    tBand: card.tBand ?? undefined,
    cAut: card.cAut ?? undefined,
  };
}

/** `pag`: one `detPag` per payment and `vTroco` when there is change. */
export function pagGroup(ctx: BuildContext): XmlNode {
  const { payments, changeCents } = ctx.draft;
  return {
    detPag: payments.map((p) => ({
      tPag: p.tPag,
      vPag: centsToString(p.cents),
      card: p.card ? cardNode(p.card) : undefined,
    })),
    vTroco: changeCents > 0 ? centsToString(changeCents) : undefined,
  };
}
