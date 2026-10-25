import 'reflect-metadata';
import type { Request, Response } from 'express';
import type { AuthContext } from '../auth/auth-context';
import type { McpConnectionRepository } from './domain/mcp-connection.repository';
import { McpController } from './mcp.controller';
import { McpServer } from './mcp.server';
import type { McpService } from './mcp.service';

const auth = { tenantId: 'tenant-1' } as AuthContext;

function build() {
  const server = new McpServer();
  const controller = new McpController(
    { getServer: () => server } as unknown as McpService,
    { recordUsage: jest.fn() } as unknown as McpConnectionRepository,
  );
  const res = {
    status: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
  } as unknown as Response;
  const post = (body: unknown) =>
    controller.post({ body, authContext: auth } as unknown as Request, res);
  return { controller, res, post };
}

describe('McpController', () => {
  it('answers a single request with a single JSON-RPC response', async () => {
    const { post } = build();
    const reply = await post({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(reply).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
  });

  it('accepts a lone notification with 202 and no body', async () => {
    const { post, res } = build();
    const reply = await post({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
    expect(reply).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(202);
  });

  it('drops notifications from a batch and keeps the responses', async () => {
    const { post, res } = build();
    const reply = await post([
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'ping' },
    ]);
    expect(reply).toEqual([{ jsonrpc: '2.0', id: 2, result: {} }]);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('answers an empty body with Invalid Request instead of crashing', async () => {
    const { post } = build();
    const reply = await post(undefined);
    expect(reply).toMatchObject({ id: null, error: { code: -32600 } });
  });

  it('refuses the optional SSE stream with 405 on GET', () => {
    const { controller, res } = build();
    controller.get(res);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.set).toHaveBeenCalledWith('Allow', 'POST');
  });

  describe('usage recording', () => {
    const call = (name: string, id = 1) => ({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: {} },
    });
    const setup = () => {
      const server = new McpServer();
      const recordUsage = jest.fn();
      const controller = new McpController(
        { getServer: () => server } as unknown as McpService,
        { recordUsage } as unknown as McpConnectionRepository,
      );
      const definition = (name: string) => ({
        name,
        description: name,
        inputSchema: { type: 'object', properties: {} },
      });
      server.registerTool(definition('nfse_issue'), async () => ({}));
      server.registerTool(definition('nfse_issue_batch'), async () => ({
        results: [
          { index: 0, status: 'accepted' },
          { index: 1, status: 'accepted', replayed: true },
          { index: 2, status: 'rejected' },
          { index: 3, status: 'accepted' },
        ],
      }));
      const post = (body: unknown) =>
        controller.post(
          {
            body,
            authContext: { tenantId: 'tenant-1', mcpConnectionId: 'conn-1' },
          } as unknown as Request,
          { status: jest.fn() } as unknown as Response,
        );
      return { recordUsage, post };
    };

    it('counts only newly issued invoices of nfse_issue_batch (not replays or rejections)', async () => {
      const { recordUsage, post } = setup();
      await post(call('nfse_issue_batch'));
      expect(recordUsage).toHaveBeenCalledWith('conn-1', 'tenant-1', {
        toolCalls: 1,
        invoicesIssued: 2,
      });
    });

    it('keeps counting one invoice per nfse_issue call', async () => {
      const { recordUsage, post } = setup();
      await post([call('nfse_issue', 1), call('nfse_issue_batch', 2)]);
      expect(recordUsage).toHaveBeenCalledWith('conn-1', 'tenant-1', {
        toolCalls: 2,
        invoicesIssued: 3,
      });
    });
  });
});
