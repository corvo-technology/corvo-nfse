import { DpsNumberingController } from './dps-numbering.controller';
import type { RequestWithAuthContext } from '@/modules/auth/auth-context';
import { NumberingCheckUnavailableError } from '../application/dps-numbering.service';

describe('DpsNumberingController', () => {
  const req = {
    authContext: { activeTenantId: 't1', executionEnvironment: 'live' },
  } as unknown as RequestWithAuthContext;
  const numbering = { check: jest.fn(), confirm: jest.fn() };
  const sequences = { numberingCheckedAt: jest.fn() };
  const controller = new DpsNumberingController(
    numbering as never,
    sequences as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('returns the check with when it was confirmed', async () => {
    const check = {
      series: '1',
      nextNumber: 1,
      usedNumbers: [1],
      suggestedNext: 2,
      moreMayBeUsed: false,
    };
    numbering.check.mockResolvedValue(check);
    sequences.numberingCheckedAt.mockResolvedValue(null);
    expect(await controller.check('c1', req)).toEqual({
      data: { ...check, checkedAt: null },
    });
    expect(numbering.check).toHaveBeenCalledWith('c1', 't1', 'live');
  });

  it('answers 503 with a code when the portal does not answer', async () => {
    numbering.check.mockRejectedValue(new NumberingCheckUnavailableError());
    await expect(controller.check('c1', req)).rejects.toMatchObject({
      code: 'DPS_NUMBERING_CHECK_UNAVAILABLE',
      kind: 'dependency',
      retryable: true,
      expected: true,
    });
  });

  it('confirms, optionally moving the number forward', async () => {
    numbering.confirm.mockResolvedValue({ series: '1', lastNumber: 3 });
    expect(await controller.confirm('c1', { lastNumber: 3 }, req)).toEqual({
      data: { series: '1', lastNumber: 3 },
    });
    expect(numbering.confirm).toHaveBeenCalledWith('c1', 't1', 'live', 3);
  });
});
