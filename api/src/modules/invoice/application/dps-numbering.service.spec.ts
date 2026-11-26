import {
  DpsNumberingService,
  NUMBERING_PROBE_LIMIT,
  NumberingCheckUnavailableError,
  NumberingNeedsConfirmationError,
  numberingNeedsConfirmationMessage,
  skippedNumbersMessage,
} from './dps-numbering.service';

const company = {
  id: 'c1',
  taxId: '11222333000181',
  municipalityCode: '3550308',
};

function build(
  opts: {
    simulated?: boolean;
    checkedAt?: Date | null;
    hasNote?: boolean;
    lastNumber?: number;
  } = {},
) {
  const provider = { queryByDps: jest.fn() };
  const sequences = {
    current: jest
      .fn()
      .mockResolvedValue({ series: '1', lastNumber: opts.lastNumber ?? 0 }),
    numberingCheckedAt: jest.fn().mockResolvedValue(opts.checkedAt ?? null),
    markNumberingChecked: jest.fn().mockResolvedValue(undefined),
    raiseTo: jest.fn().mockResolvedValue({ series: '1', lastNumber: 9 }),
  };
  const invoices = {
    hasIssuedNote: jest.fn().mockResolvedValue(opts.hasNote ?? false),
  };
  const companies = { findById: jest.fn().mockResolvedValue(company) };
  const certificates = {
    decryptCredentials: jest
      .fn()
      .mockResolvedValue({ pfxBuffer: Buffer.alloc(0), password: '' }),
  };
  const providers = {
    resolve: () => provider,
    isSimulated: () => opts.simulated ?? false,
  };
  const service = new DpsNumberingService(
    sequences as never,
    invoices as never,
    companies as never,
    certificates as never,
    providers as never,
  );
  return { service, provider, sequences, invoices };
}

const taken = { status: 'authorized', xmlAuthorized: '<x/>' };
const free = { status: 'not_found' };

describe('DpsNumberingService.check', () => {
  it('asks for the next number and stops at the first free one', async () => {
    const { service, provider } = build({ lastNumber: 0 });
    provider.queryByDps
      .mockResolvedValueOnce(taken)
      .mockResolvedValueOnce(taken)
      .mockResolvedValueOnce(taken)
      .mockResolvedValueOnce(free);

    const result = await service.check('c1', 't1', 'live');

    expect(result).toEqual({
      series: '1',
      nextNumber: 1,
      usedNumbers: [1, 2, 3],
      suggestedNext: 4,
      moreMayBeUsed: false,
    });
    expect(provider.queryByDps).toHaveBeenCalledTimes(4);
    expect(provider.queryByDps).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/000000000000001$/),
      expect.anything(),
    );
  });

  it('starts after the numbers Corvo already used', async () => {
    const { service, provider } = build({ lastNumber: 41 });
    provider.queryByDps.mockResolvedValue(free);
    const result = await service.check('c1', 't1', 'live');
    expect(result).toMatchObject({
      nextNumber: 42,
      usedNumbers: [],
      suggestedNext: 42,
    });
    expect(provider.queryByDps).toHaveBeenCalledTimes(1);
  });

  it('never asks for more than the limit and says more may be used', async () => {
    const { service, provider } = build();
    provider.queryByDps.mockResolvedValue(taken);
    const result = await service.check('c1', 't1', 'live');
    expect(provider.queryByDps).toHaveBeenCalledTimes(NUMBERING_PROBE_LIMIT);
    expect(result.moreMayBeUsed).toBe(true);
    expect(result.suggestedNext).toBe(NUMBERING_PROBE_LIMIT + 1);
  });

  it('is unavailable when the portal fails, never guessing', async () => {
    const { service, provider } = build();
    provider.queryByDps.mockRejectedValue(new Error('timeout'));
    await expect(service.check('c1', 't1', 'live')).rejects.toBeInstanceOf(
      NumberingCheckUnavailableError,
    );
  });

  it('is unavailable when the portal answer is not conclusive', async () => {
    const { service, provider } = build();
    provider.queryByDps.mockResolvedValue({ status: 'pending' });
    await expect(service.check('c1', 't1', 'live')).rejects.toBeInstanceOf(
      NumberingCheckUnavailableError,
    );
  });

  it('is unavailable when the certificate cannot be read', async () => {
    const { service } = build();
    (
      service as never as { certificates: { decryptCredentials: jest.Mock } }
    ).certificates.decryptCredentials.mockRejectedValue(new Error('no cert'));
    await expect(service.check('c1', 't1', 'live')).rejects.toBeInstanceOf(
      NumberingCheckUnavailableError,
    );
  });
});

describe('DpsNumberingService.skipUsedNumbers', () => {
  it('raises the numbering past the numbers the government confirms as used', async () => {
    const { service, provider, sequences } = build();
    provider.queryByDps
      .mockResolvedValueOnce(taken)
      .mockResolvedValueOnce(taken)
      .mockResolvedValueOnce(taken)
      .mockResolvedValueOnce(free);

    const skipped = await service.skipUsedNumbers('c1', 't1', 'live');

    expect(skipped).toEqual({ from: 1, to: 3, nextFree: 4 });
    expect(sequences.raiseTo).toHaveBeenCalledWith('c1', 't1', 'live', 3);
    expect(sequences.markNumberingChecked).toHaveBeenCalled();
    expect(skippedNumbersMessage(skipped!)).toBe(
      'Os números 1 a 3 já estavam usados no governo; a nota saiu com o número 4.',
    );
  });

  it('skips nothing and marks the check when everything is free', async () => {
    const { service, provider, sequences } = build();
    provider.queryByDps.mockResolvedValue(free);
    expect(await service.skipUsedNumbers('c1', 't1', 'live')).toBeNull();
    expect(sequences.raiseTo).not.toHaveBeenCalled();
    expect(sequences.markNumberingChecked).toHaveBeenCalled();
  });

  it('blocks when every number asked is used (cap reached), changing nothing', async () => {
    const { service, provider, sequences } = build();
    provider.queryByDps.mockResolvedValue(taken);
    await expect(
      service.skipUsedNumbers('c1', 't1', 'live'),
    ).rejects.toBeInstanceOf(NumberingNeedsConfirmationError);
    expect(sequences.raiseTo).not.toHaveBeenCalled();
    expect(sequences.markNumberingChecked).not.toHaveBeenCalled();
  });

  it('does not ask the portal again once the numbering was checked', async () => {
    const { service, provider } = build({ checkedAt: new Date() });
    expect(await service.skipUsedNumbers('c1', 't1', 'live')).toBeNull();
    expect(provider.queryByDps).not.toHaveBeenCalled();
  });

  it('does not ask the portal when the company already has a note', async () => {
    const { service, provider } = build({ hasNote: true });
    await service.skipUsedNumbers('c1', 't1', 'live');
    expect(provider.queryByDps).not.toHaveBeenCalled();
  });

  it('skips the simulator', async () => {
    const { service, provider } = build({ simulated: true });
    await service.skipUsedNumbers('c1', 't1', 'test');
    expect(provider.queryByDps).not.toHaveBeenCalled();
  });

  it('never asks the Produção Restrita (test notes have no fiscal value)', async () => {
    const { service, provider, sequences } = build();
    expect(await service.skipUsedNumbers('c1', 't1', 'test')).toBeNull();
    expect(await service.skipForward('c1', 't1', 'test')).toBeNull();
    expect(provider.queryByDps).not.toHaveBeenCalled();
    expect(sequences.raiseTo).not.toHaveBeenCalled();
  });

  it('lets the portal error through so the emission is tried again, never guessing', async () => {
    const { service, provider, sequences } = build();
    provider.queryByDps.mockRejectedValue(new Error('503'));
    await expect(service.skipUsedNumbers('c1', 't1', 'live')).rejects.toThrow(
      'tente de novo em alguns minutos',
    );
    expect(sequences.raiseTo).not.toHaveBeenCalled();
  });
});

describe('DpsNumberingService.confirm', () => {
  it('raises the number and marks the check as done', async () => {
    const { service, sequences } = build();
    await service.confirm('c1', 't1', 'live', 9);
    expect(sequences.raiseTo).toHaveBeenCalledWith('c1', 't1', 'live', 9);
    expect(sequences.markNumberingChecked).toHaveBeenCalled();
  });

  it('only marks the check when no number is given', async () => {
    const { service, sequences } = build();
    await service.confirm('c1', 't1', 'live');
    expect(sequences.raiseTo).not.toHaveBeenCalled();
    expect(sequences.markNumberingChecked).toHaveBeenCalled();
  });
});

describe('numberingNeedsConfirmationMessage', () => {
  it('speaks of one number in the singular', () => {
    expect(
      numberingNeedsConfirmationMessage({
        series: '1',
        nextNumber: 5,
        usedNumbers: [5],
        suggestedNext: 6,
        moreMayBeUsed: false,
      }),
    ).toMatch(/^O número de nota 5 já foi usado no governo/);
  });
});
