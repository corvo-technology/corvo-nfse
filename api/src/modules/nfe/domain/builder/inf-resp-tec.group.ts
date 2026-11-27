import type { BuildContext, XmlNode } from './context';

/** `infRespTec`: Corvo as the software house. No `idCSRT`: that is for NFC-e. */
export function infRespTecGroup(ctx: BuildContext): XmlNode | undefined {
  const tec = ctx.respTec;
  if (!tec) return undefined;
  return {
    CNPJ: tec.cnpj,
    xContato: tec.contact,
    email: tec.email,
    fone: tec.phone,
  };
}
