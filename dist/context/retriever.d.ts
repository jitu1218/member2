/**
 * ProofPatch MCP Server — Hybrid Context Retrieval Engine
 *
 * Implements automated, bounded, evidence-backed repository context retrieval.
 *
 * Retrieval Pipeline:
 * 1. Explicit reference inclusion (@file, @symbol).
 * 2. Query keyword extraction (identifiers, terms, routes, config).
 * 3. File path relevance matching (path tokens).
 * 4. Text search matching (lexical hits in code).
 * 5. Symbol definition resolution (via AST / symbol discovery).
 * 6. Test file association (e.g. tests/test_*.py matching candidate implementations).
 * 7. Candidate ranking based on evidence weights.
 * 8. Strict budget allocation with Context Evidence Trail (selected vs. excluded).
 */
import type { AutoContextOutput, ServerConfig, WorkspaceViewAdapter } from '../types/index.js';
export interface RetrieveContextInput {
    /** The natural language user prompt or instruction */
    prompt: string;
    /** Optional budget in characters (defaults to config.contextBudgetChars) */
    budgetChars?: number;
    /** Optional limit on number of files to select (default: 5) */
    maxFiles?: number;
}
export declare function retrieveContext(input: RetrieveContextInput, config: ServerConfig, adapter: WorkspaceViewAdapter): Promise<AutoContextOutput>;
//# sourceMappingURL=retriever.d.ts.map