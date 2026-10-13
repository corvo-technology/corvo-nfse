import { SetMetadata } from '@nestjs/common';

export const PUBLIC_ROUTE_KEY = 'isPublicRoute';

export function PublicRoute() {
  return SetMetadata(PUBLIC_ROUTE_KEY, true);
}
