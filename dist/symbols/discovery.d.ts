/**
 * ProofPatch MCP Server — Symbol Discovery Service
 *
 * Discovers and inspects code symbols across the workspace.
 * Specializes in Python AST with support for multi-language file routing.
 */
import type { ServerConfig, ToolError, WorkspaceViewAdapter } from '../types/index.js';
import { type PythonAnalysisResult } from './python-ast.js';
export interface DiscoverSymbolsInput {
    /** Relative path to the target file */
    path: string;
}
export declare function discoverSymbols(input: DiscoverSymbolsInput, config: ServerConfig, adapter: WorkspaceViewAdapter): Promise<PythonAnalysisResult | {
    error: ToolError;
}>;
//# sourceMappingURL=discovery.d.ts.map