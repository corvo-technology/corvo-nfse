export interface SchemaIssue {
  line: number | null;
  message: string;
}

export type SchemaId =
  | 'nfe'
  | 'nfeProc'
  | 'enviNFe'
  | 'consStatServ'
  | 'consSitNFe'
  | 'envEvento'
  | 'envCCe'
  | 'inutNFe';

/** Decrypted certificate, in memory only. PEM so it serves both XMLDSig and mTLS. */
export interface LoadedCertificate {
  readonly certPem: string;
  readonly keyPem: string;
  readonly cnpj: string;
  readonly notAfter: Date;
}

export interface XmlSigner {
  sign(
    xml: string,
    referenceTag: 'infNFe' | 'infEvento' | 'infInut',
    cert: LoadedCertificate,
  ): string;
}

export interface SchemaValidator {
  validate(
    xml: string,
    schema: SchemaId,
  ): Promise<{ ok: true } | { ok: false; errors: SchemaIssue[] }>;
}
