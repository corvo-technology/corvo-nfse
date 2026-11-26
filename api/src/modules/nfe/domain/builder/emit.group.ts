import type { BuildContext, XmlNode } from './context';

export function addressNode(address: {
  street: string;
  number: string;
  complement: string | null;
  district: string;
  cityCode: string;
  city: string;
  state: string;
  zip: string;
}): XmlNode {
  return {
    xLgr: address.street,
    nro: address.number,
    xCpl: address.complement ?? undefined,
    xBairro: address.district,
    cMun: address.cityCode,
    xMun: address.city,
    UF: address.state,
    CEP: address.zip,
    cPais: '1058',
    xPais: 'Brasil',
  };
}

/** `emit`: the issuer. */
export function emitGroup(ctx: BuildContext): XmlNode {
  const { issuer } = ctx.draft;
  return {
    CNPJ: issuer.cnpj,
    xNome: issuer.legalName,
    xFant: issuer.tradeName ?? undefined,
    enderEmit: addressNode(issuer.address),
    IE: issuer.stateRegistration,
    CRT: issuer.crt ?? undefined,
  };
}
