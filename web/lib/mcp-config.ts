/** Public MCP endpoint agents connect to; override per environment with NEXT_PUBLIC_MCP_URL. */
export const MCP_SERVER_URL = process.env.NEXT_PUBLIC_MCP_URL ?? "https://api.corvo.tech/mcp";
