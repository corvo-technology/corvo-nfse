import {
  HOMOLOGATION_RECIPIENT_NAME,
  type BuildContext,
  type XmlNode,
} from './context';
import { addressNode } from './emit.group';

/**
 * `dest`: the recipient. In homologation (`tpAmb` 2) the name is the fixed text the MOC demands
 * [não verificado; regra conhecida do MOC]. The NFC-e consumer may be anonymous (no group at all)
 * and the layout asks for an identification (CPF/CNPJ) whenever the group exists, so a consumer
 * with only a name or an e-mail leaves no `dest`. A NFC-e consumer has no state registration.
 */
export function destGroup(ctx: BuildContext): XmlNode | undefined {
  const { recipient } = ctx.draft;
  if (!recipient || !recipient.taxId) return undefined;
  const isCpf = recipient.taxId.length === 11;
  const name = ctx.tpAmb === 2 ? HOMOLOGATION_RECIPIENT_NAME : recipient.name;
  return {
    ...(isCpf ? { CPF: recipient.taxId } : { CNPJ: recipient.taxId }),
    xNome: name || undefined,
    enderDest: recipient.address ? addressNode(recipient.address) : undefined,
    indIEDest: recipient.indIeDest,
    IE:
      recipient.indIeDest === 1
        ? (recipient.stateRegistration ?? undefined)
        : undefined,
    email: recipient.email ?? undefined,
  };
}
