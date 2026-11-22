/**
 * ProofPatch MCP Server — Server Entry Point
 *
 * Registers MCP tools for workspace inspection and code understanding.
 * Uses the MCP SDK's McpServer class and stdio transport.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerConfig, WorkspaceViewAdapter } from './types/index.js';
import { FilesystemAdapter } from './tools/fs-adapter.js';
/**
 * Create and configure the ProofPatch MCP server.
 */
export declare function createServer(configOverrides?: Partial<ServerConfig>, customAdapter?: WorkspaceViewAdapter): {
    server: McpServer;
    config: ServerConfig;
    adapter: FilesystemAdapter;
};
/**
 * Start the MCP server with stdio transport.
 */
export declare function startServer(configOverrides?: Partial<ServerConfig>, customAdapter?: WorkspaceViewAdapter): Promise<void>;
//# sourceMappingURL=server.d.ts.map