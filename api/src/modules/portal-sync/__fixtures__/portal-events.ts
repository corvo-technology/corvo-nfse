/** Sample event XMLs shaped like the portal's `<evento>`; none of them came from the real portal. */
export const ACCESS_KEY = '21113002200574753000100000000000146726037032711025';

function eventXml(detail: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<evento versao="1.01">
  <infEvento Id="ID240520231030000000000000000000000000000000000">
    <verAplic>1.0.0</verAplic>
    <ambGer>2</ambGer>
    <nSeqEvento>1</nSeqEvento>
    <dhProc>2026-04-17T10:00:00-03:00</dhProc>
    <nDFSe>12345</nDFSe>
    <pedRegEvento versao="1.01">
      <infPedReg Id="PRE240520231030000000000000000000000000000000000">
        <tpAmb>2</tpAmb>
        <verAplic>1.0.0</verAplic>
        <dhEvento>2026-04-17T09:59:00-03:00</dhEvento>
        <CNPJAutor>00574753000100</CNPJAutor>
        <chNFSe>${ACCESS_KEY}</chNFSe>
        <nPedRegEvento>001</nPedRegEvento>
        ${detail}
      </infPedReg>
    </pedRegEvento>
  </infEvento>
  <Signature xmlns="http://www.w3.org/2000/09/xmldsig#">
    <SignedInfo>
      <CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>
      <SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>
      <Reference URI="#id1"><Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/></Transforms><DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><DigestValue>abc</DigestValue></Reference>
    </SignedInfo>
    <SignatureValue>sig</SignatureValue>
    <KeyInfo><X509Data><X509Certificate>cert</X509Certificate></X509Data></KeyInfo>
  </Signature>
</evento>`;
}

export const CANCELLATION_XML = eventXml(
  '<e101101><xDesc>Cancelamento de NFS-e</xDesc><cMotivo>1</cMotivo><xMotivo>Erro de digitação no valor</xMotivo></e101101>',
);

export const TAKER_REJECTION_XML = eventXml(
  '<e203206><xDesc>Rejeição do Tomador</xDesc><cMotivo>1</cMotivo><xMotivo>Serviço não contratado</xMotivo></e203206>',
);

export const TAKER_CONFIRMATION_XML = eventXml(
  '<e203202><xDesc>Confirmação do Tomador</xDesc></e203202>',
);

export const CANCELLATION_WITHOUT_REASON_XML = eventXml(
  '<e305101><xDesc>Cancelamento de NFS-e por Ofício</xDesc><CPFAgTrib>01234567890</CPFAgTrib><nProcAdm>PROC-1</nProcAdm><xProcAdm>Decisão</xProcAdm></e305101>',
);

export const BROKEN_XML = '<evento><infEvento>';
