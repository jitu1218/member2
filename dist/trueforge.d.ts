/**
 * ProofPatch MCP Server — TrueForge Registration Helper
 *
 * Provides TrueForge integration configuration and definitions for Member 1.
 * Member 1's agent harness can either:
 *  1. Launch this server via stdio as an external MCP server:
 *     { command: "node", args: ["<path>/mcp-server/dist/index.js", "<workspaceRoot>"] }
 *  2. Register tools in-process using `getMcpToolDefinitions()`.
 */
import type { ServerConfig, WorkspaceViewAdapter } from './types/index.js';
export interface TrueForgeToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    handler: (args: any) => Promise<any>;
}
/**
 * Returns in-process tool definitions for direct integration with Member 1's TrueForge harness.
 */
export declare function getTrueForgeTools(configOverrides?: Partial<ServerConfig>, customAdapter?: WorkspaceViewAdapter): TrueForgeToolDefinition[];
//# sourceMappingURL=trueforge.d.ts.map