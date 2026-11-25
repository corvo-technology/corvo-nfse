import type { AuthContext } from '../auth/auth-context';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// MCP JSON-RPC request types
export interface McpRequest {
  jsonrpc: '2.0';
  /** Absent on notifications, which never get a response. */
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface McpResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** Protocol revisions this server speaks, newest first. */
export const MCP_SUPPORTED_PROTOCOL_VERSIONS = [
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
] as const;

export const MCP_SERVER_INFO = {
  name: 'corvo-nfse',
  version: '1.0.0',
} as const;

/** Picks the client's protocol version when supported, otherwise our newest. */
export function negotiateProtocolVersion(requested: unknown): string {
  return (
    MCP_SUPPORTED_PROTOCOL_VERSIONS.find((v) => v === requested) ??
    MCP_SUPPORTED_PROTOCOL_VERSIONS[0]
  );
}

function isJsonRpcRequest(value: unknown): value is McpRequest {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<McpRequest>;
  return message.jsonrpc === '2.0' && typeof message.method === 'string';
}

export type McpContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

/** Return this from a tool handler to send text and/or image content as is. */
export class McpToolResult {
  constructor(readonly content: McpContent[]) {}
}

/**
 * Text sent to the agent on `initialize`: the order of the tools for a new
 * account. Self-hosted has no billing, so the purchase steps are left out.
 */
export function mcpInstructions(selfHosted: boolean): string {
  const lines = [
    'Corvo issues Brazilian NFS-e invoices. The person already signed in through OAuth. Follow this route:',
    '1. cnpj_lookup: fetch the public registry data of the CNPJ.',
    '2. company_create: create the issuing company with that data.',
    '3. certificate_upload: send the A1 certificate. Take the password only from your own secret vault and never repeat it in the conversation.',
    '4. company_fiscal_status: repeat until the company is ready to issue.',
    '5. nfse_issue: issue the invoice.',
    '6. credits_balance: check how many invoices are left.',
  ];
  if (!selfHosted) {
    lines.push(
      '7. credits_purchase: when credits run out, confirm the quantity and the total amount with the person, then show the QR Code and copy-and-paste code or the link. The person always completes the payment.',
      '8. payment_status: repeat until the status is paid, then keep issuing.',
    );
  }
  lines.push(
    'If an invoice is in manual_review, explain it to the person and suggest nfse_review with retry; use discard only after the person explicitly confirms.',
    'If a tool says it lacks permission, ask the person to reconnect and tick that option when authorizing.',
  );
  return lines.join('\n');
}

type ToolHandler = (params: unknown, ctx: AuthContext) => Promise<unknown>;

export class McpServer {
  private readonly instructions?: string;

  constructor(options: { instructions?: string } = {}) {
    this.instructions = options.instructions;
  }

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

  /**
   * Handles one JSON-RPC message. Returns `null` for notifications (no `id`),
   * which per the spec must not be answered.
   */
  async handleRequest(
    request: McpRequest,
    authContext: AuthContext,
  ): Promise<McpResponse | null> {
    if (!isJsonRpcRequest(request)) {
      return {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Invalid Request' },
      };
    }
    if (request.id === undefined || request.id === null) return null;
    const id = request.id;
    try {
      return await this.dispatch(request, id, authContext);
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: 'Internal error', data: String(err) },
      };
    }
  }

  private dispatch(
    request: McpRequest,
    id: number | string,
    authContext: AuthContext,
  ): Promise<McpResponse> | McpResponse {
    switch (request.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: negotiateProtocolVersion(
              request.params?.protocolVersion,
            ),
            capabilities: { tools: {} },
            serverInfo: { ...MCP_SERVER_INFO },
            ...(this.instructions ? { instructions: this.instructions } : {}),
          },
        };
      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id,
          result: { tools: this.getToolDefinitions() },
        };
      case 'tools/call':
        return this.handleToolCall(request, authContext);
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };
      default:
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: 'Method not found' },
        };
    }
  }

  private async handleToolCall(
    request: McpRequest,
    ctx: AuthContext,
  ): Promise<McpResponse> {
    const id = request.id as number | string;
    const { name, arguments: args } = request.params as {
      name: string;
      arguments?: unknown;
    };
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Tool '${name}' not found` },
      };
    }
    try {
      const result = await tool.handler(args ?? {}, ctx);
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content:
            result instanceof McpToolResult
              ? result.content
              : [{ type: 'text', text: JSON.stringify(result) }],
        },
      };
    } catch (err) {
      // MCP reports tool failures as a normal result with isError so the agent can read and react to them.
      const message =
        err instanceof Error ? err.message : 'Tool execution failed';
      return {
        jsonrpc: '2.0',
        id,
        result: { isError: true, content: [{ type: 'text', text: message }] },
      };
    }
  }
}
