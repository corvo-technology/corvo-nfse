import { DpsSequenceController } from './dps-sequence.controller';
import type { RequestWithAuthContext } from '@/modules/auth/auth-context';
import {
  explainRejection,
  rejectionCode,
} from '@/infra/external/nfse/rejection-guidance';

describe('DpsSequenceController', () => {
  const req = {
    authContext: { activeTenantId: 't1', executionEnvironment: 'live' },
  } as unknown as RequestWithAuthContext;
  const sequences = {
    current: jest.fn(),
    raiseTo: jest.fn(),
    reserveNext: jest.fn(),
  };
  const controller = new DpsSequenceController(sequences);

  beforeEach(() => jest.clearAllMocks());

  it('reads the numbering of the company in the caller environment', async () => {
    sequences.current.mockResolvedValue({ series: '1', lastNumber: 7 });
    expect(await controller.get('c1', req)).toEqual({
      data: { series: '1', lastNumber: 7 },
    });
    expect(sequences.current).toHaveBeenCalledWith('c1', 't1', 'live');
  });

  it('sets the last number and hands back what the sequence now holds', async () => {
    sequences.current.mockResolvedValue({ series: '1', lastNumber: 7 });
    sequences.raiseTo.mockResolvedValue({ series: '1', lastNumber: 120 });
    expect(await controller.set('c1', { lastNumber: 120 }, req)).toEqual({
      data: { series: '1', lastNumber: 120 },
    });
    expect(sequences.raiseTo).toHaveBeenCalledWith('c1', 't1', 'live', 120);
  });
});

describe('DpsSequenceController lowering', () => {
  const req = {
    authContext: { activeTenantId: 't1', executionEnvironment: 'live' },
  } as unknown as RequestWithAuthContext;
  const sequences = {
    current: jest.fn(),
    raiseTo: jest.fn(),
    reserveNext: jest.fn(),
  };
  const controller = new DpsSequenceController(sequences);

  it('rejects a number lower than one already used, without touching the sequence', async () => {
    sequences.current.mockResolvedValue({ series: '1', lastNumber: 50 });
    await expect(
      controller.set('c1', { lastNumber: 10 }, req),
    ).rejects.toMatchObject({
      response: { code: 'DPS_NUMBER_BELOW_CURRENT' },
    });
    expect(sequences.raiseTo).not.toHaveBeenCalled();
  });

  it('accepts the same number again', async () => {
    sequences.current.mockResolvedValue({ series: '1', lastNumber: 50 });
    sequences.raiseTo.mockResolvedValue({ series: '1', lastNumber: 50 });
    await controller.set('c1', { lastNumber: 50 }, req);
    expect(sequences.raiseTo).toHaveBeenCalled();
  });
});

describe('E0014 guidance', () => {
  it('tells the user how to continue the numbering', () => {
    const text = explainRejection('Rejeição da Receita [E0014]: já existe');
    expect(text).toContain('E0014');
    expect(text).toContain('Esse número de nota já foi usado');
    expect(text).toContain('configurações da empresa');
  });

  it('maps E0014 to its own code and leaves other codes alone', () => {
    expect(rejectionCode('E0014')).toBe('DPS_NUMBER_ALREADY_USED');
    expect(rejectionCode('E0120')).toBe('E0120');
  });
});
