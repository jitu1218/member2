/**
 * ProofPatch MCP Server — read-file Tool
 *
 * Reads file content with safety checks:
 * - Path traversal prevention
 * - Workspace boundary enforcement
 * - Sensitive file exclusion
 * - Binary file detection
 * - Size limits
 * - Line range reads
 * - Truncation indicators
 */
import type { ReadFileInput, ReadFileOutput, ServerConfig, ToolError, WorkspaceViewAdapter } from '../types/index.js';
/**
 * Read file content with comprehensive safety checks.
 */
export declare function readFile(input: ReadFileInput, config: ServerConfig, adapter: WorkspaceViewAdapter): Promise<ReadFileOutput | {
    error: ToolError;
}>;
//# sourceMappingURL=read-file.d.ts.map