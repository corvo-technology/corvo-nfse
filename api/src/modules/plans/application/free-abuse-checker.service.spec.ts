import { FreeAbuseChecker } from './free-abuse-checker.service';
import { FreeAbuseDetectedError } from '../domain/free-abuse-detected.error';
import type { ITenantPlanRepository } from '../domain/tenant-plan-assignment';
import type { TurnstileVerificationService } from '@/modules/security/application/turnstile-verification.service';

describe('FreeAbuseChecker', () => {
  const repo = {
    existsFreeTenantWithBillingEmail: jest.fn(),
    existsFreeTenantWithBillingTaxId: jest.fn(),
  };
  const turnstile = { verify: jest.fn() };
  const checker = new FreeAbuseChecker(
    repo as unknown as ITenantPlanRepository,
    turnstile as unknown as TurnstileVerificationService,
  );

  beforeEach(() => jest.resetAllMocks());

  it('rejects an e-mail already on a free workspace', async () => {
    repo.existsFreeTenantWithBillingEmail.mockResolvedValue(true);
    await expect(
      checker.assertEmailNotInFreeWorkspace('a@b.com'),
    ).rejects.toMatchObject({ code: 'email_already_free' });
  });

  it('accepts a new e-mail', async () => {
    repo.existsFreeTenantWithBillingEmail.mockResolvedValue(false);
    await expect(
      checker.assertEmailNotInFreeWorkspace('a@b.com'),
    ).resolves.toBeUndefined();
  });

  it('rejects a tax id already on a free workspace', async () => {
    repo.existsFreeTenantWithBillingTaxId.mockResolvedValue(true);
    await expect(
      checker.assertTaxIdNotInFreeWorkspace('123'),
    ).rejects.toBeInstanceOf(FreeAbuseDetectedError);
  });

  it('rejects when turnstile fails', async () => {
    turnstile.verify.mockResolvedValue({ success: false, errorCodes: ['x'] });
    await expect(checker.verifyTurnstile('t', '1.1.1.1')).rejects.toMatchObject(
      { code: 'turnstile_invalid' },
    );
  });

  it('passes when turnstile succeeds', async () => {
    turnstile.verify.mockResolvedValue({ success: true });
    await expect(checker.verifyTurnstile('t', '1.1.1.1')).resolves.toBe(true);
  });
});
