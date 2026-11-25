import type { Request } from 'express';
import { McpDiscoveryController } from './mcp-discovery.controller';

describe('McpDiscoveryController', () => {
  const urls = {
    mcpResource: () => 'https://api.test/mcp',
    apiOrigin: () => 'https://api.test',
  };
  const controller = new McpDiscoveryController(urls as never);
  const req = {} as Request;

  it('advertises the four scopes in scopes_supported', () => {
    const expected = [
      'nfse:read',
      'nfse:write',
      'nfse:certificates',
      'billing:purchase',
    ];
    expect(controller.protectedResource(req).scopes_supported).toEqual(
      expected,
    );
    expect(controller.authorizationServer(req).scopes_supported).toEqual(
      expected,
    );
  });
});
