import { Reflector } from '@nestjs/core';
import { ApiKeyEndpoint, API_KEY_ENDPOINT } from './api-key-endpoint.decorator';

describe('ApiKeyEndpoint', () => {
  it('marks an operation as available to API-key authentication', () => {
    class Controller {
      @ApiKeyEndpoint()
      endpoint() {}
    }

    const reflector = new Reflector();
    expect(reflector.get(API_KEY_ENDPOINT, Controller.prototype.endpoint)).toBe(
      true,
    );
  });
});
