import { AccountantPackageController } from './accountant-package.controller';

const TENANT = '01927de2-1234-7890-abcd-ef0123456789';
const COMPANY = '11111111-1111-4111-8111-111111111111';
const request = (extra: Record<string, unknown> = {}) =>
  ({
    authContext: {
      activeTenantId: TENANT,
      executionEnvironment: 'live',
      ...extra,
    },
  }) as never;

describe('AccountantPackageController', () => {
  const accountant = {
    listSends: jest.fn(),
    sendNow: jest.fn(),
  };
  const controller = new AccountantPackageController(accountant as never);
  beforeEach(() => jest.clearAllMocks());

  it('lists the send history of the company in the environment of the caller', async () => {
    const items = [{ id: 's1', status: 'sent', month: '2026-10' }];
    accountant.listSends.mockResolvedValue(items);
    const result = await controller.sends(
      COMPANY,
      request({ apiKeyEnvironment: 'test' }),
    );
    expect(accountant.listSends).toHaveBeenCalledWith(TENANT, COMPANY, 'test');
    expect(result.data).toEqual(items);
  });

  it('marks a send made with an API key or an MCP connection', async () => {
    accountant.sendNow.mockResolvedValue('sent');
    await controller.send(
      COMPANY,
      { month: '2026-10' },
      request({ apiKeyEnvironment: 'live' }),
    );
    expect(accountant.sendNow).toHaveBeenLastCalledWith(
      TENANT,
      COMPANY,
      'live',
      '2026-10',
      'mcp-or-api',
    );
    await controller.send(
      COMPANY,
      { month: '2026-10' },
      request({ mcpConnectionId: 'c1' }),
    );
    expect(accountant.sendNow).toHaveBeenLastCalledWith(
      TENANT,
      COMPANY,
      'live',
      '2026-10',
      'mcp-or-api',
    );
  });

  it('marks a send made from the dashboard as manual', async () => {
    accountant.sendNow.mockResolvedValue('skipped-empty');
    const result = await controller.send(
      COMPANY,
      { month: '2026-10' },
      request(),
    );
    expect(accountant.sendNow).toHaveBeenCalledWith(
      TENANT,
      COMPANY,
      'live',
      '2026-10',
      'manual',
    );
    expect(result.data).toEqual({ status: 'skipped-empty' });
  });
});
