import { SignedXml } from 'xml-crypto';
import type {
  LoadedCertificate,
  XmlSigner,
} from '@/modules/fiscal-core/domain/ports/xml.port';

/**
 * Algorithms fixed by the official `xmldsig-core-schema_v1.01.xsd` of the NF-e packages (the
 * schema pins every one of them with `fixed=`): inclusive C14N 1.0, RSA-SHA1 and SHA-1. SHA-1 is
 * not a choice: the layout 4.00 XSD requires it, so any other algorithm fails the schema.
 */
const ALGORITHMS = {
  canonicalization: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  signature: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
  digest: 'http://www.w3.org/2000/09/xmldsig#sha1',
  enveloped: 'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
} as const;

const DSIG_NS = 'http://www.w3.org/2000/09/xmldsig#';

export class XmlAlreadySignedError extends Error {
  constructor() {
    super('The XML already has a Signature element');
    this.name = 'XmlAlreadySignedError';
  }
}

export class XmlSigningError extends Error {
  constructor(reason: string) {
    super(`Could not sign the XML: ${reason}`);
    this.name = 'XmlSigningError';
  }
}

type ReferenceTag = 'infNFe' | 'infEvento' | 'infInut';

/** Base64 body (no header/footer, no line breaks) of the first certificate of a PEM bundle. */
export function firstCertificateBase64(pem: string): string {
  const match =
    /-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/.exec(pem);
  if (!match) throw new XmlSigningError('no certificate in the PEM');
  return match[1].replace(/\s+/g, '');
}

function hasSignature(xml: string): boolean {
  return /<(?:[\w-]+:)?Signature[\s>]/.test(xml);
}

function referenceId(xml: string, tag: ReferenceTag): string {
  const element = new RegExp(`<${tag}\\b[^>]*>`).exec(xml);
  const id = element ? /\bId="([^"]+)"/.exec(element[0]) : null;
  if (!id) throw new XmlSigningError(`<${tag}> without an Id attribute`);
  return id[1];
}

/**
 * Enveloped XMLDSig of the NF-e, of its events and of the inutilization request. `<Signature>` is
 * the last child of the parent of the signed element (`NFe`, `evento`, `inutNFe`).
 */
export class SefazXmlSigner implements XmlSigner {
  sign(
    xml: string,
    referenceTag: ReferenceTag,
    cert: LoadedCertificate,
  ): string {
    if (hasSignature(xml)) throw new XmlAlreadySignedError();
    const id = referenceId(xml, referenceTag);
    const certBase64 = firstCertificateBase64(cert.certPem);

    const signer = new SignedXml({
      privateKey: cert.keyPem,
      canonicalizationAlgorithm: ALGORITHMS.canonicalization,
      signatureAlgorithm: ALGORITHMS.signature,
      getKeyInfoContent: () =>
        `<X509Data><X509Certificate>${certBase64}</X509Certificate></X509Data>`,
    });
    signer.addReference({
      xpath: `//*[@Id='${id}']`,
      transforms: [ALGORITHMS.enveloped, ALGORITHMS.canonicalization],
      digestAlgorithm: ALGORITHMS.digest,
      uri: `#${id}`,
    });
    try {
      signer.computeSignature(xml, {
        location: {
          reference: `//*[@Id='${id}']/..`,
          action: 'append',
        },
      });
    } catch {
      // The library message can quote the document (personal data), so it is not propagated.
      throw new XmlSigningError('the signature could not be computed');
    }
    return signer.getSignedXml();
  }
}

/**
 * A `<Signature>` with the right shape and size but placeholder values (all-zero digest and
 * signature), appended like the real one. For the dry-run validation: the XSD checks the
 * structure, nothing is ever sent with it.
 */
export function withStructuralSignature(
  xml: string,
  referenceTag: ReferenceTag,
): string {
  if (hasSignature(xml)) throw new XmlAlreadySignedError();
  const id = referenceId(xml, referenceTag);
  const digest = Buffer.alloc(20).toString('base64');
  const signatureValue = Buffer.alloc(256).toString('base64');
  const certificate = Buffer.alloc(64).toString('base64');
  const signature =
    `<Signature xmlns="${DSIG_NS}"><SignedInfo>` +
    `<CanonicalizationMethod Algorithm="${ALGORITHMS.canonicalization}"/>` +
    `<SignatureMethod Algorithm="${ALGORITHMS.signature}"/>` +
    `<Reference URI="#${id}"><Transforms>` +
    `<Transform Algorithm="${ALGORITHMS.enveloped}"/>` +
    `<Transform Algorithm="${ALGORITHMS.canonicalization}"/>` +
    `</Transforms><DigestMethod Algorithm="${ALGORITHMS.digest}"/>` +
    `<DigestValue>${digest}</DigestValue></Reference></SignedInfo>` +
    `<SignatureValue>${signatureValue}</SignatureValue>` +
    `<KeyInfo><X509Data><X509Certificate>${certificate}</X509Certificate></X509Data></KeyInfo>` +
    '</Signature>';
  const parent = PARENT_CLOSING_TAG[referenceTag];
  const at = xml.lastIndexOf(parent);
  if (at < 0) throw new XmlSigningError(`no ${parent} in the XML`);
  return xml.slice(0, at) + signature + xml.slice(at);
}

const PARENT_CLOSING_TAG: Record<ReferenceTag, string> = {
  infNFe: '</NFe>',
  infEvento: '</evento>',
  infInut: '</inutNFe>',
};
