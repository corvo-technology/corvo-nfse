import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';

/** Marks an operation as part of Corvo's public API-key integration surface. */
export const API_KEY_ENDPOINT = 'apiKeyEndpoint';
/** Extension the public OpenAPI document uses to keep only the public operations. */
export const PUBLIC_OPERATION_EXTENSION = 'x-corvo-public';
/** Extension of the few public operations that need no API key (liveness). */
export const NO_AUTH_OPERATION_EXTENSION = 'x-corvo-no-auth';

export function ApiKeyEndpoint() {
  return applyDecorators(
    SetMetadata(API_KEY_ENDPOINT, true),
    ApiExtension(PUBLIC_OPERATION_EXTENSION, true),
  );
}

/** Publishes an operation that needs no API key (it must also be a `@PublicRoute()`). */
export function PublicApiEndpoint() {
  return applyDecorators(
    ApiExtension(PUBLIC_OPERATION_EXTENSION, true),
    ApiExtension(NO_AUTH_OPERATION_EXTENSION, true),
  );
}
