export type Uf =
  | 'AC'
  | 'AL'
  | 'AP'
  | 'AM'
  | 'BA'
  | 'CE'
  | 'DF'
  | 'ES'
  | 'GO'
  | 'MA'
  | 'MT'
  | 'MS'
  | 'MG'
  | 'PA'
  | 'PB'
  | 'PR'
  | 'PE'
  | 'PI'
  | 'RJ'
  | 'RN'
  | 'RS'
  | 'RO'
  | 'RR'
  | 'SC'
  | 'SP'
  | 'SE'
  | 'TO';

/** 1 normal, 6 SVC-AN, 7 SVC-RS, 9 offline (only 1 is used before the contingency phase). */
export type TpEmis = 1 | 6 | 7 | 9;

export type SefazService =
  | 'NfeAutorizacao'
  | 'NfeRetAutorizacao'
  | 'NfeConsultaProtocolo'
  | 'NfeStatusServico'
  | 'RecepcaoEvento'
  | 'NfeInutilizacao';

export type AuthorityId =
  | 'AM'
  | 'BA'
  | 'GO'
  | 'MG'
  | 'MS'
  | 'MT'
  | 'PE'
  | 'PR'
  | 'RS'
  | 'SP'
  | 'SVAN'
  | 'SVRS';

export interface AuthorityEndpoint {
  authority: AuthorityId;
  url: string;
  soapAction: string;
  version: '4.00' | '1.00';
}

export interface AuthorityTarget {
  uf: Uf;
  tpAmb: 1 | 2;
  model: 55 | 65;
  tpEmis: TpEmis;
}

export interface AuthorityEndpointResolver {
  /** Data, not code: UF x environment x model x tpEmis x service -> URL + version. */
  resolve(q: AuthorityTarget & { service: SefazService }): AuthorityEndpoint;
}
