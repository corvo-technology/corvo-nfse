import {
  HOMOLOGATION_RECIPIENT_NAME,
  type BuildContext,
  type XmlNode,
} from './context';
import { addressNode } from './emit.group';

/**
 * `dest`: the recipient. In homologation (`tpAmb` 2) the name is the fixed text the MOC demands
 * [não verificado; regra conhecida do MOC].
 */
export function destGroup(ctx: BuildContext): XmlNode {
  const { recipient } = ctx.draft;
  const isCpf = recipient.taxId.length === 11;
  return {
    ...(isCpf ? { CPF: recipient.taxId } : { CNPJ: recipient.taxId }),
    xNome: ctx.tpAmb === 2 ? HOMOLOGATION_RECIPIENT_NAME : recipient.name,
    enderDest: addressNode(recipient.address),
    indIEDest: recipient.indIeDest,
    IE:
      recipient.indIeDest === 1
        ? (recipient.stateRegistration ?? undefined)
        : undefined,
    email: recipient.email ?? undefined,
  };
}
