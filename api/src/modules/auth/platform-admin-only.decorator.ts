import { SetMetadata } from '@nestjs/common';

/**
 * Marks a route as platform-admin only. Metadata only: the barrier is the
 * PlatformAdminGuard; ApiKeyGuard reads this to answer 404 instead of 403.
 */
export const PLATFORM_ADMIN_ONLY = 'platformAdminOnly';

export function PlatformAdminOnly(): MethodDecorator & ClassDecorator {
  return SetMetadata(PLATFORM_ADMIN_ONLY, true);
}
