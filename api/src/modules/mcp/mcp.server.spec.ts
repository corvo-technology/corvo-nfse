import 'reflect-metadata';
import type { AuthContext } from '../auth/auth-context';
import {
  MCP_SUPPORTED_PROTOCOL_VERSIONS,
  McpServer,
  type McpRequest,
} from './mcp.server';

const ctx = { tenantId: 'tenant-1' } as AuthContext;

function server(): McpServer {
  const mcp = new McpServer();
  mcp.registerTool(
    { name: 'echo', description: 'Echo', inputSchema: { type: 'object' } },
    (params) => Promise.resolve(params),
  );
  return mcp;
}

const initialize = (protocolVersion?: string): McpRequest => ({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: 'claude-code', version: '2.1.299' },
  },
});

describe('McpServer', () => {
  describe('initialize', () => {
    it('answers with protocolVersion, capabilities and serverInfo as the spec requires', async () => {
      const response = await server().handleRequest(
        initialize('2025-06-18'),
        ctx,
      );
      expect(response).toEqual({
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'corvo-nfse', version: '1.0.0' },
        },
      });
    });

    it('does not leak name/version at the top level of the result', async () => {
      const response = await server().handleRequest(initialize(), ctx);
      expect(response?.result).not.toHaveProperty('name');
      expect(response?.result).not.toHaveProperty('version');
    });

    it('echoes any supported protocol version', async () => {
      for (const version of MCP_SUPPORTED_PROTOCOL_VERSIONS) {
        const response = await server().handleRequest(initialize(version), ctx);
        expect(
          (response?.result as { protocolVersion: string }).protocolVersion,
        ).toBe(version);
      }
    });

    it('falls back to the newest version for an unknown one', async () => {
      const response = await server().handleRequest(
        initialize('1999-01-01'),
        ctx,
      );
      expect(
        (response?.result as { protocolVersion: string }).protocolVersion,
      ).toBe(MCP_SUPPORTED_PROTOCOL_VERSIONS[0]);
    });
  });

  describe('notifications', () => {
    it('never answers a notification (no id)', async () => {
      const response = await server().handleRequest(
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        ctx,
      );
      expect(response).toBeNull();
    });

    it('does not answer an unknown notification with an error', async () => {
      const response = await server().handleRequest(
        { jsonrpc: '2.0', method: 'notifications/whatever' },
        ctx,
      );
      expect(response).toBeNull();
    });
  });

  describe('requests', () => {
    it('lists registered tools', async () => {
      const response = await server().handleRequest(
        { jsonrpc: '2.0', id: 'a', method: 'tools/list' },
        ctx,
      );
      expect(response).toMatchObject({
        id: 'a',
        result: { tools: [{ name: 'echo' }] },
      });
    });

    it('answers ping with an empty result', async () => {
      const response = await server().handleRequest(
        { jsonrpc: '2.0', id: 2, method: 'ping' },
        ctx,
      );
      expect(response).toEqual({ jsonrpc: '2.0', id: 2, result: {} });
    });

    it('reports unknown methods as -32601 keeping the request id', async () => {
      const response = await server().handleRequest(
        { jsonrpc: '2.0', id: 3, method: 'resources/list' },
        ctx,
      );
      expect(response).toMatchObject({ id: 3, error: { code: -32601 } });
    });

    it('rejects a malformed message with -32600 and a null id', async () => {
      const response = await server().handleRequest(
        undefined as unknown as McpRequest,
        ctx,
      );
      expect(response).toEqual({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Invalid Request' },
      });
    });

    it('returns tool failures as isError results', async () => {
      const mcp = new McpServer();
      mcp.registerTool(
        { name: 'boom', description: 'x', inputSchema: {} },
        () => Promise.reject(new Error('nope')),
      );
      const response = await mcp.handleRequest(
        {
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: { name: 'boom' },
        },
        ctx,
      );
      expect(response).toMatchObject({
        id: 4,
        result: { isError: true, content: [{ type: 'text', text: 'nope' }] },
      });
    });
  });
});
