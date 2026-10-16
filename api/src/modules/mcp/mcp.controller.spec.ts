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
});
