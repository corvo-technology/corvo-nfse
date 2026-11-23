import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNfseXml } from 'open-nfse';
import {
  formatCTribNac,
  formatCep,
  formatDate,
  formatDateTime,
  formatMoney,
  formatPhone,
  formatTaxId,
} from './danfse-format';
import { buildDanfseView } from './danfse-view';
import { generateDanfse } from './danfse';

const xml = readFileSync(
  join(__dirname, '__fixtures__', 'authorized-nfse.xml'),
  'utf8',
);

describe('danfse formatters', () => {
  it('formats tax ids, including alphanumeric CNPJ', () => {
    expect(formatTaxId('61469487000140')).toBe('61.469.487/0001-40');
    expect(formatTaxId('11144477735')).toBe('111.444.777-35');
    expect(formatTaxId('RLJ1XFI8000102')).toBe('RL.J1X.FI8/0001-02');
    expect(formatTaxId(undefined)).toBe('-');
  });

  it('formats phone, CEP, money, dates and codes', () => {
    expect(formatPhone('1433358959')).toBe('(14) 3335-8959');
    expect(formatPhone('14999998888')).toBe('(14) 99999-8888');
    expect(formatCep('19900011')).toBe('19900-011');
    expect(formatMoney(1234.5)).toBe('R$ 1.234,50');
    expect(formatMoney(undefined)).toBe('-');
    expect(formatDate(new Date('2026-10-16T00:00:00Z'))).toBe('16/10/2026');
    expect(formatDateTime(new Date('2026-10-16T23:33:15Z'))).toBe(
      '16/10/2026 20:33:15',
    );
    expect(formatCTribNac('010301')).toBe('01.03.01');
  });
});

describe('buildDanfseView', () => {
  const nfse = parseNfseXml(xml);

  it('marks homologation notes with the invalid-document stamp', () => {
    const view = buildDanfseView(nfse);
    expect(view.header.homologation).toBe(true);
    expect(view.header.environment).toContain('Homologação');
    expect(view.qrUrl).toBe(
      `https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=${nfse.infNFSe.chaveAcesso}`,
    );
  });

  it('collapses absent recipient and intermediary into one line', () => {
    const view = buildDanfseView(nfse);
    const messages = view.parties.filter((b) => b.kind === 'message');
    expect(messages.map((m) => m.kind === 'message' && m.message)).toEqual([
      'DESTINATÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e',
      'INTERMEDIÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e',
    ]);
  });

  it('prints "-" for empty fields and omits the empty IBS/CBS block', () => {
    const view = buildDanfseView(nfse);
    expect(view.taxation).toHaveLength(2);
    expect(JSON.stringify(view.totals)).toContain('R$ 49,90');
  });

  it('adds the watermark and the extra notes', () => {
    const view = buildDanfseView(nfse, {
      status: 'cancelled',
      notes: ['Nota de teste'],
    });
    expect(view.header.watermark).toBe('CANCELADA');
    expect(view.additionalInfo).toContain('Nota de teste');
  });

  it('marks a substituted note with the SUBSTITUÍDA watermark and none when valid', () => {
    expect(buildDanfseView(nfse, { status: 'replaced' }).header.watermark).toBe(
      'SUBSTITUÍDA',
    );
    expect(buildDanfseView(nfse).header.watermark).toBeUndefined();
  });

  describe('Finalidade (finNFSe)', () => {
    function finalidade(group: unknown): string {
      const infDPS = nfse.infNFSe.DPS.infDPS;
      const withGroup = {
        ...nfse,
        infNFSe: {
          ...nfse.infNFSe,
          DPS: { ...nfse.infNFSe.DPS, infDPS: { ...infDPS, IBSCBS: group } },
        },
      } as unknown as typeof nfse;
      const cell = buildDanfseView(withGroup)
        .identification.flat()
        .find((c) => c.label === 'Finalidade');
      return cell?.value ?? '';
    }
    const trib = { valores: { trib: { gIBSCBS: {} } } };

    it('maps 0, 1 and 2 as the official generator does', () => {
      expect(finalidade({ ...trib, finNFSe: '0' })).toBe('NFS-e regular');
      expect(finalidade({ ...trib, finNFSe: '1' })).toBe(
        'NFS-e de substituição',
      );
      expect(finalidade({ ...trib, finNFSe: 2 })).toBe('NFS-e de ajuste');
    });

    it('prints "-" when finNFSe is missing or unknown, or there is no IBS/CBS group', () => {
      expect(finalidade({ ...trib })).toBe('-');
      expect(finalidade({ ...trib, finNFSe: '7' })).toBe('-');
      expect(finalidade(undefined)).toBe('-');
    });
  });
});

describe('generateDanfse', () => {
  it('produces a one-page A4 PDF', async () => {
    const pdf = await generateDanfse(parseNfseXml(xml));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(1);
  });
});
