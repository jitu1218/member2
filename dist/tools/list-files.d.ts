/**
 * ProofPatch MCP Server — list-files Tool
 *
 * Lists files within the workspace root, respecting ignore rules,
 * workspace boundaries, and exclusion patterns.
 */
import type { ListFilesInput, ListFilesOutput, ServerConfig, ToolError, WorkspaceViewAdapter } from '../types/index.js';
/**
 * List files within the workspace, respecting exclusion rules.
 */
export declare function listFiles(input: ListFilesInput, config: ServerConfig, adapter: WorkspaceViewAdapter): Promise<ListFilesOutput | {
    error: ToolError;
}>;
//# sourceMappingURL=list-files.d.ts.map