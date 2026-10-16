import { NfseEmissionProcessor } from './nfse-emission.processor';
import { NfseReconciliationProcessor } from './nfse-reconciliation.processor';

for (const Processor of [NfseEmissionProcessor, NfseReconciliationProcessor]) {
  describe(Processor.name, () => {
    const data = { invoiceId: 'invoice', tenantId: 'tenant' };
    it('uses the same invoice lock for emission and reconciliation and always releases it', async () => {
      const lock = { key: 'key', token: 'token' };
      const locks = {
        acquire: jest.fn().mockResolvedValue(lock),
        release: jest.fn(),
      };
      const workflow = {
        process: jest.fn().mockRejectedValue(new Error('network')),
      };
      const processor = new Processor(locks as any, workflow as any);
      await expect(processor.process({ data } as any)).rejects.toThrow(
        'network',
      );
      expect(locks.acquire).toHaveBeenCalledWith('nfse:invoice:invoice', {
        ttlMs: 300000,
      });
      expect(workflow.process).toHaveBeenCalledWith(data);
      expect(locks.release).toHaveBeenCalledWith(lock);
    });
    it('retries contention without acknowledging an unprocessed invoice', async () => {
      const workflow = { process: jest.fn() };
      const processor = new Processor(
        { acquire: async () => null } as any,
        workflow as any,
      );
      await expect(processor.process({ data } as any)).rejects.toThrow(
        'already being processed',
      );
      expect(workflow.process).not.toHaveBeenCalled();
    });
  });
}

describe('NfseEmissionProcessor failure surfacing', () => {
  const data = { invoiceId: 'invoice', tenantId: 'tenant' };
  const build = () => {
    const workflow = { handleEmissionExhausted: jest.fn() };
    return {
      workflow,
      processor: new NfseEmissionProcessor({} as any, workflow as any),
    };
  };

  it('surfaces the failure on the invoice only after the last attempt', async () => {
    const { workflow, processor } = build();
    const error = new Error('boom');

    await processor.onFailed(
      { data, attemptsMade: 4, opts: { attempts: 5 } } as any,
      error,
    );
    expect(workflow.handleEmissionExhausted).not.toHaveBeenCalled();

    await processor.onFailed(
      { data, attemptsMade: 5, opts: { attempts: 5 } } as any,
      error,
    );
    expect(workflow.handleEmissionExhausted).toHaveBeenCalledWith(data, error);
  });

  it('ignores failures that have no job', async () => {
    const { workflow, processor } = build();
    await processor.onFailed(undefined, new Error('boom'));
    expect(workflow.handleEmissionExhausted).not.toHaveBeenCalled();
  });
});
