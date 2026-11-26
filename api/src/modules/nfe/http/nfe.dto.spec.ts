import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { NfeRequestDto } from './nfe.dto';
import { inputFixture } from '../testing/draft-fixture';

async function problems(body: unknown): Promise<string[]> {
  const errors = await validate(plainToInstance(NfeRequestDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const paths = (list: typeof errors, prefix = ''): string[] =>
    list.flatMap((error) => {
      const path = `${prefix}${prefix ? '.' : ''}${error.property}`;
      return [
        ...(error.constraints ? [path] : []),
        ...paths(error.children ?? [], path),
      ];
    });
  return paths(errors);
}

const valid = () => ({
  ...inputFixture(),
  companyId: 'b0a0f1c2-0000-4000-8000-000000000001',
});

describe('NfeRequestDto', () => {
  it('accepts a complete body in camelCase', async () => {
    expect(await problems(valid())).toEqual([]);
  });

  it('refuses the snake_case body of the design spec', async () => {
    expect(
      (await problems({ company_id: 'x', recipient: {}, items: [] })).length,
    ).toBeGreaterThan(0);
  });

  it('wants at least one item and one payment, and at most 990 items', async () => {
    expect(await problems({ ...valid(), items: [] })).toContain('items');
    expect(await problems({ ...valid(), payments: [] })).toContain('payments');
    const item = inputFixture().items[0];
    expect(
      await problems({
        ...valid(),
        items: Array.from({ length: 991 }, () => item),
      }),
    ).toContain('items');
  });

  it('limits the decimals: quantity 4, unit price 10, amounts 2', async () => {
    const item = inputFixture().items[0];
    expect(
      await problems({
        ...valid(),
        items: [{ ...item, quantity: 1.3333, unitPrice: 0.3333333333 }],
      }),
    ).toEqual([]);
    expect(
      await problems({ ...valid(), items: [{ ...item, quantity: 1.33333 }] }),
    ).toContain('items.0.quantity');
    expect(
      await problems({
        ...valid(),
        items: [{ ...item, unitPrice: 0.33333333333 }],
      }),
    ).toContain('items.0.unitPrice');
    expect(
      await problems({ ...valid(), items: [{ ...item, discount: 1.005 }] }),
    ).toContain('items.0.discount');
    expect(
      await problems({ ...valid(), payments: [{ tPag: '17', amount: 1.001 }] }),
    ).toContain('payments.0.amount');
  });

  it('limits description to 120 and additionalInfo to 5000 characters', async () => {
    const item = inputFixture().items[0];
    expect(
      await problems({
        ...valid(),
        items: [{ ...item, description: 'x'.repeat(121) }],
      }),
    ).toContain('items.0.description');
    expect(
      await problems({ ...valid(), additionalInfo: 'x'.repeat(5001) }),
    ).toContain('additionalInfo');
  });

  it('accepts only indIeDest 1, 2 or 9', async () => {
    const body = valid();
    expect(
      await problems({
        ...body,
        recipient: { ...body.recipient, indIeDest: 3 },
      }),
    ).toContain('recipient.indIeDest');
  });

  it('wants the recipient and its address', async () => {
    const { recipient: _omit, ...rest } = valid();
    expect(await problems(rest)).toContain('recipient');
    const body = valid();
    const { address: _address, ...noAddress } = body.recipient;
    expect(await problems({ ...body, recipient: noAddress })).toContain(
      'recipient.address',
    );
  });

  it('does not take totals from the customer', async () => {
    expect(await problems({ ...valid(), vNF: 10 })).toContain('vNF');
  });
});
