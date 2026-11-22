/**
 * ProofPatch MCP Server — grep-filter Utility
 *
 * Shared filtering logic for file and search tools:
 * - .gitignore parsing (simplified)
 * - Multi-pattern matching
 * - File-type classification
 */
import type { WorkspaceViewAdapter } from '../types/index.js';
/** A parsed gitignore rule */
interface IgnoreRule {
    /** The original pattern text */
    pattern: string;
    /** Whether this is a negation rule (starts with !) */
    negated: boolean;
    /** Whether this is a directory-only rule (ends with /) */
    directoryOnly: boolean;
    /** The compiled regex for matching */
    regex: RegExp;
}
/**
 * Parse a .gitignore file and return compiled rules.
 * Supports:
 *   - Comments (#)
 *   - Negation (!)
 *   - Directory markers (/)
 *   - Wildcards (*, **, ?)
 *   - Anchored patterns (leading /)
 */
export declare function parseGitignore(content: string): IgnoreRule[];
/**
 * Check if a relative path is ignored by the given rules.
 */
export declare function isIgnoredByRules(relativePath: string, isDirectory: boolean, rules: IgnoreRule[]): boolean;
/**
 * Load and parse .gitignore from the workspace root if it exists.
 */
export declare function loadGitignore(workspaceRoot: string, adapter: WorkspaceViewAdapter): Promise<IgnoreRule[]>;
/**
 * Classify a file by its extension for search relevance.
 */
export type FileCategory = 'source' | 'test' | 'config' | 'documentation' | 'data' | 'style' | 'script' | 'other';
export declare function classifyFile(relativePath: string): FileCategory;
export {};
//# sourceMappingURL=grep-filter.d.ts.map