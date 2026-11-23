import { randomUUID } from 'node:crypto';
import {
  getDatabaseScope,
  runAsPlatformAdminOnTenant,
  runWithAuthUser,
  runWithTenant,
} from './tenant-context.storage';

describe('runAsPlatformAdminOnTenant', () => {
  const A = randomUUID();
  const B = randomUUID();

  it('troca o tenant do request pelo alvo, sem system', () =>
    runWithTenant(A, () =>
      runAsPlatformAdminOnTenant(B, () =>
        expect(getDatabaseScope()).toEqual({ tenantId: B }),
      ),
    ));

  it('descarta o authUserId do request', () =>
    runWithAuthUser(randomUUID(), () =>
      runWithTenant(A, () =>
        runAsPlatformAdminOnTenant(B, () => {
          const scope = getDatabaseScope();
          expect(scope?.authUserId).toBeUndefined();
          expect(scope?.system).toBeUndefined();
        }),
      ),
    ));

  it('devolve o valor do trabalho', () =>
    expect(runAsPlatformAdminOnTenant(B, () => 42)).toBe(42));

  it('rejeita tenantId que não é UUID', () =>
    expect(() => runAsPlatformAdminOnTenant('x', () => 1)).toThrow());
});
