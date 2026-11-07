import type { AuthContext } from '@/modules/auth/auth-context';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';

/**
 * The batch emission only reads the execution environment from the auth context. Import jobs run
 * without a request, so they carry just that, for the tenant that owns the import.
 */
export function importAuthContext(
  tenantId: string,
  environment: ExecutionEnvironment,
): AuthContext {
  return {
    authUserId: 'system:import',
    productKey: 'corvo',
    userId: 'system:import',
    tenantId,
    activeTenantId: tenantId,
    role: 'admin',
    contextType: 'tenant',
    platformRole: null,
    platformPermissions: [],
    permissions: [],
    isPlatformAdmin: false,
    executionEnvironment: environment,
  };
}
