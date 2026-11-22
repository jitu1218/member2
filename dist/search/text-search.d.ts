/**
 * ProofPatch MCP Server — text-search Tool
 *
 * Efficient text search within the workspace using either:
 *   1. ripgrep (rg) if available — fast, respects .gitignore natively
 *   2. Pure Node.js fallback — recursive walk + line-by-line matching
 *
 * Features:
 * - Case-sensitive / insensitive search
 * - Regex and literal search
 * - File glob / extension filtering
 * - Context lines before/after matches
 * - Bounded result count
 * - Search timeout
 * - Workspace boundary enforcement
 * - Exclusion rules (node_modules, .git, binary files, etc.)
 * - Sensitive file exclusion
 */
import type { ServerConfig, TextSearchInput, TextSearchOutput, ToolError, WorkspaceViewAdapter } from '../types/index.js';
/**
 * Search for text within the workspace.
 * Tries ripgrep first; falls back to Node.js walker.
 */
export declare function textSearch(input: TextSearchInput, config: ServerConfig, adapter: WorkspaceViewAdapter): Promise<TextSearchOutput | {
    error: ToolError;
}>;
/**
 * Recursively collect file paths that pass exclusion and filter checks.
 * Respects workspace boundaries, exclusion rules, and the deadline.
 */
declare function collectFiles(rootDir: string, config: ServerConfig, adapter: WorkspaceViewAdapter, fileFilter: ((relPath: string, basename: string) => boolean) | undefined, deadline: number, maxFiles?: number): Promise<string[]>;
/**
 * Build a file filter function from a glob-like pattern.
 */
declare function buildFileFilter(pattern: string): (relPath: string, basename: string) => boolean;
/** Escape special regex characters in a string for literal matching. */
declare function escapeRegExp(str: string): string;
export { escapeRegExp, buildFileFilter, collectFiles };
//# sourceMappingURL=text-search.d.ts.map