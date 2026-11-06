import { CreditsController } from './credits.controller';

const req = { authContext: { activeTenantId: 't' } } as never;
function build(usage: Record<string, unknown>) {
  return new CreditsController(
    {} as never,
    { status: jest.fn().mockResolvedValue(usage) } as never,
    {} as never,
  );
}

describe('CreditsController.getBalance', () => {
  it('adds plan notes and avulso notes while the plan is usable', async () => {
    const out = await build({
      included_remaining: 40,
      avulsoBalance: 5,
      hard_limit: 100,
      blocked: false,
    }).getBalance(req);
    expect(out).toMatchObject({
      balance: 45,
      planRemaining: 40,
      avulsoBalance: 5,
    });
  });
  it('does not count plan notes nobody can use once the plan lapsed', async () => {
    const out = await build({
      included_remaining: 40,
      avulsoBalance: 5,
      hard_limit: 100,
      blocked: true,
    }).getBalance(req);
    expect(out).toMatchObject({
      balance: 5,
      planRemaining: 0,
      avulsoBalance: 5,
    });
  });
});
