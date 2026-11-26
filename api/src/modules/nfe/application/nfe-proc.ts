const NFE_NS = 'http://www.portalfiscal.inf.br/nfe';

const DECLARATION = /^\s*<\?xml[^>]*\?>\s*/;

/** The text of a single element (`<tag ...>...</tag>`), or `null` when it is not what the XML is. */
function elementOf(xml: string, tag: string): string | null {
  const text = xml.replace(DECLARATION, '').trim();
  return new RegExp(`^<${tag}[\\s>][\\s\\S]*</${tag}>$`).test(text)
    ? text
    : null;
}

/**
 * The `nfeProc` of the NF-e: the signed `NFe` followed by the `protNFe` the SEFAZ answered, inside
 * `<nfeProc versao="4.00">`. Both pieces are joined as text, never parsed and written again: any
 * change to the bytes of the `NFe` would break its signature.
 */
export function buildNfeProc(signedXml: string, protNFeXml: string): string {
  const nfe = elementOf(signedXml, 'NFe');
  if (!nfe) throw new Error('The signed XML is not an NFe');
  const prot = elementOf(protNFeXml, 'protNFe');
  if (!prot) throw new Error('The protocol XML is not a protNFe');
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00" xmlns="${NFE_NS}">${nfe}${prot}</nfeProc>`;
}
