import { runValidators } from '@/modules/fiscal-core/application/emission-pipeline';
import { NFE_PRE_SEND_VALIDATORS } from './index';
import { draftFixture, inputFixture } from '../../testing/draft-fixture';
import type { NfeInput, NfeItemInput } from '../nfe-input';

const run = (input: Partial<NfeInput> = {}, issuer = {}) =>
  runValidators(NFE_PRE_SEND_VALIDATORS, draftFixture(input, issuer), {
    environment: 'test',
  });

const item = (overrides: Partial<NfeItemInput> = {}): NfeItemInput => ({
  ...inputFixture().items[0],
  ...overrides,
});

const recipient = (overrides: Record<string, unknown> = {}) => ({
  ...inputFixture().recipient,
  ...overrides,
});

describe('NFE_PRE_SEND_VALIDATORS', () => {
  it('passes a valid document', async () => {
    expect(await run()).toEqual([]);
  });

  describe('card', () => {
    const pay = (tPag: string, card?: NfeInput['payments'][0]['card']) =>
      run({ payments: [{ tPag, amount: 20, card }] });
    const codes = (issues: Array<{ code: string }>) =>
      issues.map((i) => i.code);

    it('Pix without card passes: the minimal group is added', async () => {
      expect(await pay('17')).toEqual([]);
    });

    it('integrated payment (tpIntegra 1) without CNPJ and authorization is refused', async () => {
      expect(codes(await pay('03', { tpIntegra: 1 }))).toEqual([
        'NFCE_CARD_DATA_REQUIRED',
      ]);
    });

    it('card with cash is refused', async () => {
      expect(codes(await pay('01', {}))).toEqual(['NFCE_CARD_NOT_ALLOWED']);
    });
  });

  describe('tax id', () => {
    it('accepts a CNPJ and an alphanumeric CNPJ', async () => {
      expect(
        await run({
          recipient: recipient({
            taxId: '11.222.333/0001-81',
            indIeDest: 9,
          }),
        }),
      ).toEqual([]);
      expect(
        await run({ recipient: recipient({ taxId: '12.ABC.345/01DE-35' }) }),
      ).toEqual([]);
    });

    it.each(['123.456.789-00', '11222333000182', '123', ''])(
      'refuses %p',
      async (taxId) => {
        const issues = await run({ recipient: recipient({ taxId }) });
        expect(issues).toEqual([
          expect.objectContaining({
            field: 'recipient.taxId',
            code: 'TAX_ID_INVALID',
          }),
        ]);
      },
    );
  });

  describe('recipient state registration', () => {
    it('requires the IE of a contributor', async () => {
      expect(
        (await run({ recipient: recipient({ indIeDest: 1 }) }))[0],
      ).toMatchObject({
        code: 'RECIPIENT_IE_INVALID',
        field: 'recipient.stateRegistration',
      });
      expect(
        await run({
          recipient: recipient({
            indIeDest: 1,
            stateRegistration: '110.042.490.114',
          }),
        }),
      ).toEqual([]);
    });

    it.each([2, 9])('forbids an IE when indIeDest is %s', async (indIeDest) => {
      const issues = await run({
        recipient: recipient({ indIeDest, stateRegistration: '110042490114' }),
      });
      expect(issues.map((i) => i.code)).toEqual(['RECIPIENT_IE_INVALID']);
    });

    it('refuses an indIeDest outside 1, 2 and 9', async () => {
      const issues = await run({ recipient: recipient({ indIeDest: 3 }) });
      expect(issues[0]).toMatchObject({ field: 'recipient.indIeDest' });
    });
  });

  it('requires an NCM with 8 digits, naming the item', async () => {
    const issues = await run({
      items: [item(), item({ ncm: '1234567' })],
      payments: [{ tPag: '17', amount: 40 }],
    });
    expect(issues).toEqual([
      expect.objectContaining({ field: 'items[1].ncm', code: 'NCM_INVALID' }),
    ]);
  });

  describe('CFOP and destination', () => {
    it('wants 5xxx inside the UF and 6xxx outside it', async () => {
      expect(
        (
          await run({
            items: [item({ cfop: '6102' })],
            payments: [{ tPag: '17', amount: 20 }],
          })
        ).map((i) => i.code),
      ).toEqual(['CFOP_DESTINATION_MISMATCH']);
      const rj = recipient({
        address: { ...inputFixture().recipient.address, state: 'RJ' },
      });
      expect(
        await run({ recipient: rj, items: [item({ cfop: '6102' })] }),
      ).toEqual([]);
      expect(
        (await run({ recipient: rj })).map((i) => [i.field, i.code]),
      ).toEqual([['items[0].cfop', 'CFOP_DESTINATION_MISMATCH']]);
    });

    it('refuses a CFOP that is not 4 digits', async () => {
      expect(
        (await run({ items: [item({ cfop: '51' })] })).map((i) => i.code),
      ).toEqual(['CFOP_DESTINATION_MISMATCH']);
    });
  });

  it('accepts CSOSN 400 and refuses any other', async () => {
    expect(await run({ items: [item({ tax: { csosn: '400' } })] })).toEqual([]);
    expect(await run({ items: [item({ tax: { csosn: '101' } })] })).toEqual([
      expect.objectContaining({
        field: 'items[0].tax.csosn',
        code: 'CSOSN_NOT_SUPPORTED',
      }),
    ]);
  });

  describe('text charset (Review Focus 3)', () => {
    it('refuses an emoji and names the field', async () => {
      const issues = await run({ items: [item({ description: 'Caneca 😀' })] });
      expect(issues).toEqual([
        expect.objectContaining({
          field: 'items[0].description',
          code: 'TEXT_CHARSET_INVALID',
        }),
      ]);
    });

    it('accepts & < " and accents', async () => {
      expect(
        await run({
          items: [item({ description: 'Café & Cia <"promo"> ação' })],
          additionalInfo: 'Pedido #1 & "obs" <ok> à vista',
        }),
      ).toEqual([]);
    });

    it('refuses control characters and line breaks in additionalInfo', async () => {
      expect(
        (await run({ additionalInfo: 'linha 1\nlinha 2' })).map((i) => i.field),
      ).toEqual(['additionalInfo']);
    });

    it('covers the recipient name and the nature of the operation', async () => {
      const issues = await run({
        natOp: 'Venda 🚀',
        recipient: recipient({ name: 'Zé 🙂' }),
      });
      expect(issues.map((i) => i.field)).toEqual(['natOp', 'recipient.name']);
    });
  });

  describe('phase 1 scope', () => {
    it('refuses finNfe other than 1', async () => {
      expect(await run({ finNfe: 2 })).toEqual([
        expect.objectContaining({
          field: 'finNfe',
          code: 'OUT_OF_PHASE1_SCOPE',
        }),
      ]);
    });

    it('refuses a CRT that is not Simples or MEI', async () => {
      expect(await run({}, { crt: 3 })).toEqual([
        expect.objectContaining({
          field: 'company.crt',
          code: 'OUT_OF_PHASE1_SCOPE',
        }),
      ]);
    });
  });

  it('returns every problem at once, in order', async () => {
    const issues = await run({
      recipient: recipient({ taxId: '111' }),
      items: [item({ ncm: '1' })],
      payments: [{ tPag: '17', amount: 1 }],
    });
    expect(issues.map((i) => i.code)).toEqual([
      'TAX_ID_INVALID',
      'NCM_INVALID',
      'PAYMENTS_TOTAL_MISMATCH',
    ]);
  });
});
