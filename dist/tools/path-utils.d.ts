/**
 * ProofPatch MCP Server — Path Safety Utilities
 *
 * All path resolution, validation, and safety checks for workspace tools.
 * Prevents path traversal and workspace escape.
 */
import { type ToolError } from '../types/index.js';
/**
 * Resolve a user-provided relative path to an absolute path within
 * the workspace, returning an error if the resolved path escapes.
 */
export declare function resolveWorkspacePath(workspaceRoot: string, relativePath: string): {
    absolutePath: string;
} | {
    error: ToolError;
};
/**
 * Check if a path contains traversal sequences like ".." that
 * attempt to escape the workspace.
 */
export declare function hasTraversalAttempt(inputPath: string): boolean;
/**
 * Check if a file path matches sensitive file patterns.
 */
export declare function isSensitiveFile(filePath: string): boolean;
/**
 * Check if a file has a binary extension.
 */
export declare function isBinaryFile(filePath: string): boolean;
/**
 * Check if a path segment or file matches default exclude patterns.
 */
export declare function isExcludedPath(relativePath: string, additionalExcludes?: string[]): boolean;
/**
 * Get the relative path from workspace root.
 */
export declare function toRelativePath(workspaceRoot: string, absolutePath: string): string;
//# sourceMappingURL=path-utils.d.ts.map