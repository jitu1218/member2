/**
 * ProofPatch MCP Server — Reference Resolver Service
 *
 * Extracts and resolves explicit `@file:path` and `@symbol:name` references.
 * Never invents results; returns ambiguity or not_found when evidence is insufficient.
 */
import type { ExplicitReference, ResolvedFileReference, ResolvedSymbolReference, ResolveReferencesOutput, ServerConfig, WorkspaceViewAdapter } from '../types/index.js';
/**
 * Extracts @file:target and @symbol:target references from user query / prompt text.
 * Also supports @file(target) and bare @path/to/file syntax if prefixed with @file.
 */
export declare function extractExplicitReferences(text: string): ExplicitReference[];
/**
 * Resolves a single @file reference.
 */
export declare function resolveFileReference(ref: ExplicitReference, config: ServerConfig, adapter: WorkspaceViewAdapter): Promise<ResolvedFileReference>;
/**
 * Resolves a single @symbol reference across the repository.
 */
export declare function resolveSymbolReference(ref: ExplicitReference, config: ServerConfig, adapter: WorkspaceViewAdapter): Promise<ResolvedSymbolReference>;
/**
 * Resolves a list of explicit references.
 */
export declare function resolveExplicitReferences(textOrRefs: string | ExplicitReference[], config: ServerConfig, adapter: WorkspaceViewAdapter): Promise<ResolveReferencesOutput>;
//# sourceMappingURL=references.d.ts.map