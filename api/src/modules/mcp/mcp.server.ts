import type { AuthContext } from '../auth/auth-context';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// MCP JSON-RPC request types
export interface McpRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface McpResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// Server metadata (returned on initialize)
export const MCP_SERVER_INFO = {
  name: 'corvo-nfse',
  version: '1.0.0',
  protocolVersion: '2024-11-05',
  capabilities: { tools: {} },
} as const;

type ToolHandler = (params: unknown, ctx: AuthContext) => Promise<unknown>;

export class McpServer {
  private readonly tools = new Map<
    string,
    { definition: ToolDefinition; handler: ToolHandler }
  >();

  /**
   * Registers a tool with its full definition (name, description, inputSchema)
   * so `tools/list` can return real metadata instead of placeholders.
   */
  registerTool(definition: ToolDefinition, handler: ToolHandler): void {
    this.tools.set(definition.name, { definition, handler });
  }

  getToolDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(({ definition }) => ({
      name: definition.name,
      description: definition.description,
      inputSchema: definition.inputSchema,
    }));
  }

  async handleRequest(request: McpRequest, authContext: AuthContext): Promise<McpResponse> {
    try {
      switch (request.method) {
        case 'initialize':
          return { jsonrpc: '2.0', id: request.id, result: { ...MCP_SERVER_INFO } };
        case 'tools/list':
          return { jsonrpc: '2.0', id: request.id, result: { tools: this.getToolDefinitions() } };
        case 'tools/call':
          return this.handleToolCall(request, authContext);
        case 'ping':
          return { jsonrpc: '2.0', id: request.id, result: {} };
        default:
          return { jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } };
      }
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32603, message: 'Internal error', data: String(err) },
      };
    }
  }

  private async handleToolCall(request: McpRequest, ctx: AuthContext): Promise<McpResponse> {
    const { name, arguments: args } = request.params as { name: string; arguments?: unknown };
    const tool = this.tools.get(name);
    if (!tool) {
      return { jsonrpc: '2.0', id: request.id, error: { code: -32601, message: `Tool '${name}' not found` } };
    }
    try {
      const result = await tool.handler(args ?? {}, ctx);
      return { jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } };
    } catch (err) {
      // MCP reports tool failures as a normal result with isError so the agent can read and react to them.
      const message = err instanceof Error ? err.message : 'Tool execution failed';
      return { jsonrpc: '2.0', id: request.id, result: { isError: true, content: [{ type: 'text', text: message }] } };
    }
  }
}
