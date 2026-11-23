import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PlatformCreditGrantDto } from './platform-credit-grant.dto';

const check = (body: Record<string, unknown>) =>
  validate(
    plainToInstance(PlatformCreditGrantDto, {
      amount: 10,
      reason: 'cortesia de teste',
      ...body,
    }),
  );

describe('PlatformCreditGrantDto', () => {
  it('aceita 1 e 500 e usa notifyUser=false por padrão', async () => {
    expect(await check({ amount: 1 })).toHaveLength(0);
    expect(await check({ amount: 500 })).toHaveLength(0);
    expect(
      plainToInstance(PlatformCreditGrantDto, { amount: 5, reason: 'abcde' })
        .notifyUser,
    ).toBe(false);
  });

  it.each([0, 501, 1.5, '10'])('amount %p é inválido', async (amount) => {
    expect((await check({ amount })).length).toBeGreaterThan(0);
  });

  it.each(['abcd', '    ', 'x'.repeat(501)])(
    'reason inválido',
    async (reason) => {
      expect((await check({ reason })).length).toBeGreaterThan(0);
    },
  );

  it('notifyUser precisa ser booleano', async () => {
    expect((await check({ notifyUser: 'yes' })).length).toBeGreaterThan(0);
  });
});
