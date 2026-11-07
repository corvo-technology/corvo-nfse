import { DpsSequenceController } from './dps-sequence.controller';
import type { RequestWithAuthContext } from '@/modules/auth/auth-context';
import { explainRejection } from '@/infra/external/nfse/rejection-guidance';

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
    sequences.raiseTo.mockResolvedValue({ series: '1', lastNumber: 120 });
    expect(await controller.set('c1', { lastNumber: 120 }, req)).toEqual({
      data: { series: '1', lastNumber: 120 },
    });
    expect(sequences.raiseTo).toHaveBeenCalledWith('c1', 't1', 'live', 120);
  });
});

describe('E0014 guidance', () => {
  it('tells the user how to continue the numbering', () => {
    const text = explainRejection('Rejeição da Receita [E0014]: já existe');
    expect(text).toContain('E0014');
    expect(text).toContain('Numeração das notas');
  });
});
