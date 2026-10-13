import { SetMetadata } from '@nestjs/common';

/** Marks an operation as part of Corvo's public API-key integration surface. */
export const API_KEY_ENDPOINT = 'apiKeyEndpoint';

export function ApiKeyEndpoint() {
  return SetMetadata(API_KEY_ENDPOINT, true);
}
