/**
 * ProofPatch MCP Server — Python AST Parser
 *
 * Invokes python-ast-worker.py via child process with pure JS regex fallback
 * if Python runtime is unavailable or parsing fails.
 */
import type { SymbolConfidence, SymbolDiscoveryOutput } from '../types/index.js';
export interface CallSite {
    name: string;
    startLine: number;
    endLine: number;
    caller?: string | null;
    confidence: SymbolConfidence;
}
export interface PythonAnalysisResult extends SymbolDiscoveryOutput {
    calls: CallSite[];
}
export declare function findPythonPath(): Promise<string | null>;
/**
 * Parse Python code using Python's native AST module.
 */
export declare function parsePythonWithAst(source: string, relativePath: string): Promise<PythonAnalysisResult>;
/**
 * Fallback regex/heuristic parser when AST execution is unavailable.
 */
export declare function fallbackRegexParser(source: string, relativePath: string, extraLimitations?: string[]): PythonAnalysisResult;
//# sourceMappingURL=python-ast.d.ts.map