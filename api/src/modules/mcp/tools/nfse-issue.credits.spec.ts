import 'reflect-metadata';
import type { AuthContext } from '@/modules/auth/auth-context';
import { createNfseIssueHandler } from './nfse-issue.tool';

const context = {
  tenantId: 'tenant-1',
  executionEnvironment: 'test',
} as AuthContext;
const input = {
  company_id: '09947127-2702-4f6d-9da8-cb463608d812',
  amount: 10,
};
const HINT =
  ' Sem créditos: use credits_purchase para gerar uma cobrança (Pix ou cartão) e payment_status para acompanhar.';

describe('nfse_issue out of credits', () => {
  it('suggests credits_purchase when credits run out', async () => {
    for (const name of ['InsufficientCreditsError', 'QuotaExceededError']) {
      const error = Object.assign(new Error('No credits'), { name });
      const emit = jest.fn().mockRejectedValue(error);
      const failure = await createNfseIssueHandler({ emit })(
        input,
        context,
      ).catch((e: Error) => e);
      expect((failure as Error).message).toBe(`No credits${HINT}`);
    }
  });

  it('does not touch other errors', async () => {
    const emit = jest.fn().mockRejectedValue(new Error('Company not found'));
    await expect(
      createNfseIssueHandler({ emit })(input, context),
    ).rejects.toThrow(/^Company not found$/);
  });

  it('does not suggest a purchase when self-hosted', async () => {
    jest.resetModules();
    jest.doMock('@/shared/deployment-mode', () => ({ IS_SELF_HOSTED: true }));
    const tool =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./nfse-issue.tool') as typeof import('./nfse-issue.tool');
    const error = Object.assign(new Error('No credits'), {
      name: 'InsufficientCreditsError',
    });
    const emit = jest.fn().mockRejectedValue(error);
    await expect(
      tool.createNfseIssueHandler({ emit })(input, context),
    ).rejects.toThrow(/^No credits$/);
    jest.dontMock('@/shared/deployment-mode');
  });
});
