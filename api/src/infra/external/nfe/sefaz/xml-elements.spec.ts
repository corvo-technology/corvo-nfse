import { elementXml } from './nfe-gateway';
import { openingTag } from './xml-signer';

describe('elementXml', () => {
  it('returns the element with its attributes, as written', () => {
    expect(
      elementXml('<a><evento versao="1.00"><x/></evento></a>', 'evento'),
    ).toBe('<evento versao="1.00"><x/></evento>');
  });

  it('keeps the namespace declaration of the element', () => {
    const xml =
      '<env><retEvento xmlns="http://www.portalfiscal.inf.br/nfe"><a/></retEvento></env>';
    expect(elementXml(xml, 'retEvento')).toBe(
      '<retEvento xmlns="http://www.portalfiscal.inf.br/nfe"><a/></retEvento>',
    );
  });

  it('stops at the first closing tag when the same name is nested', () => {
    expect(elementXml('<e><e>1</e>2</e>', 'e')).toBe('<e><e>1</e>');
  });

  it('is undefined when the tag or its closing is missing', () => {
    expect(elementXml('<a/>', 'evento')).toBeUndefined();
    expect(elementXml('<evento><x/>', 'evento')).toBeUndefined();
  });

  it('does not take a tag that only starts with the name', () => {
    expect(elementXml('<NFeProc><NFe>1</NFe></NFeProc>', 'NFe')).toBe(
      '<NFe>1</NFe>',
    );
    expect(elementXml('<NFeProc>1</NFeProc>', 'NFe')).toBeUndefined();
    expect(elementXml('<NFeProc>1</NFeProc><NFe>2</NFe>', 'NFe')).toBe(
      '<NFe>2</NFe>',
    );
  });
});

describe('openingTag', () => {
  it('returns the opening tag with its attributes', () => {
    expect(
      openingTag(
        '<NFe><infNFe versao="4.00" Id="NFe123">x</infNFe></NFe>',
        'infNFe',
      ),
    ).toBe('<infNFe versao="4.00" Id="NFe123">');
  });

  it('takes the first of nested same-name tags', () => {
    expect(openingTag('<a Id="1"><a Id="2">', 'a')).toBe('<a Id="1">');
  });

  it('is null when missing or never closed', () => {
    expect(openingTag('<x/>', 'infNFe')).toBeNull();
    expect(openingTag('<infNFe Id="1"', 'infNFe')).toBeNull();
  });

  it('does not take a tag that only starts with the name', () => {
    expect(openingTag('<infNFeSupl a="1"><infNFe Id="2">', 'infNFe')).toBe(
      '<infNFe Id="2">',
    );
    expect(openingTag('<infNFeSupl a="1">', 'infNFe')).toBeNull();
  });
});
