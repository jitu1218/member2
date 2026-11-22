/**
 * ProofPatch MCP Server — Reference Resolver Service
 *
 * Extracts and resolves explicit `@file:path` and `@symbol:name` references.
 * Never invents results; returns ambiguity or not_found when evidence is insufficient.
 */

import type {
  ExplicitReference,
  ResolvedFileReference,
  ResolvedReference,
  ResolvedSymbolReference,
  ResolveReferencesOutput,
  ServerConfig,
  SymbolInfo,
  WorkspaceViewAdapter,
} from '../types/index.js';
import { readFile } from '../tools/read-file.js';
import { textSearch } from '../search/text-search.js';
import { discoverSymbols } from '../symbols/discovery.js';

/**
 * Extracts @file:target and @symbol:target references from user query / prompt text.
 * Also supports @file(target) and bare @path/to/file syntax if prefixed with @file.
 */
export function extractExplicitReferences(text: string): ExplicitReference[] {
  const references: ExplicitReference[] = [];
  const seen = new Set<string>();

  // Pattern matches @file:path/to/file or @file:\"path/with spaces\"
  // or @symbol:function_name
  const regex = /@(file|symbol):(?:"([^"]+)"|([^\s,;)]+))/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const raw = match[0];
    const kind = match[1] as 'file' | 'symbol';
    const target = (match[2] || match[3] || '').trim();

    const key = `${kind}:${target}`;
    if (!seen.has(key) && target) {
      seen.add(key);
      references.push({ raw, kind, target });
    }
  }

  return references;
}

/**
 * Resolves a single @file reference.
 */
export async function resolveFileReference(
  ref: ExplicitReference,
  config: ServerConfig,
  adapter: WorkspaceViewAdapter,
): Promise<ResolvedFileReference> {
  const readRes = await readFile({ path: ref.target }, config, adapter);

  if ('error' in readRes) {
    return {
      raw: ref.raw,
      kind: 'file',
      status: readRes.error.code === 'FILE_NOT_FOUND' ? 'not_found' : 'invalid',
      target: ref.target,
      error: readRes.error.message,
    };
  }

  return {
    raw: ref.raw,
    kind: 'file',
    status: 'resolved',
    target: ref.target,
    relativePath: readRes.relativePath,
    content: readRes.content,
    totalLines: readRes.totalLines,
    sizeBytes: readRes.sizeBytes,
  };
}

/**
 * Resolves a single @symbol reference across the repository.
 */
export async function resolveSymbolReference(
  ref: ExplicitReference,
  config: ServerConfig,
  adapter: WorkspaceViewAdapter,
): Promise<ResolvedSymbolReference> {
  const symbolName = ref.target;

  // Search for candidate files containing symbol name
  const searchRes = await textSearch(
    {
      query: symbolName,
      caseSensitive: true,
      maxResults: 100,
    },
    config,
    adapter,
  );

  if ('error' in searchRes) {
    return {
      raw: ref.raw,
      kind: 'symbol',
      status: 'invalid',
      target: symbolName,
      matches: [],
      error: `Search failed: ${searchRes.error.message}`,
    };
  }

  // Unique files containing matches
  const candidateFiles = Array.from(
    new Set(searchRes.matches.map((m) => m.relativePath)),
  );

  const matchedSymbols: SymbolInfo[] = [];

  for (const file of candidateFiles) {
    // Symbol discovery works on Python files natively via AST
    const symbolsRes = await discoverSymbols({ path: file }, config, adapter);
    if (!('error' in symbolsRes)) {
      for (const sym of symbolsRes.symbols) {
        if (sym.name === symbolName) {
          matchedSymbols.push(sym);
        }
      }
    }
  }

  if (matchedSymbols.length === 0) {
    // If no AST definition, check if search returned confirmed literal matches
    if (searchRes.matches.length > 0) {
      return {
        raw: ref.raw,
        kind: 'symbol',
        status: 'not_found',
        target: symbolName,
        matches: [],
        error: `Symbol definition "${symbolName}" was not found in AST analysis (though ${searchRes.matches.length} text occurrences exist).`,
      };
    }
    return {
      raw: ref.raw,
      kind: 'symbol',
      status: 'not_found',
      target: symbolName,
      matches: [],
      error: `Symbol "${symbolName}" not found in workspace.`,
    };
  }

  if (matchedSymbols.length === 1) {
    const sym = matchedSymbols[0];
    let snippet: string | undefined;

    // Fetch snippet for the symbol
    const readRes = await readFile(
      {
        path: sym.relativePath,
        startLine: sym.startLine,
        endLine: sym.endLine,
      },
      config,
      adapter,
    );

    if (!('error' in readRes)) {
      snippet = readRes.content;
    }

    return {
      raw: ref.raw,
      kind: 'symbol',
      status: 'resolved',
      target: symbolName,
      matches: matchedSymbols,
      selectedMatch: sym,
      snippet,
    };
  }

  // Multiple definitions found -> Ambiguous
  return {
    raw: ref.raw,
    kind: 'symbol',
    status: 'ambiguous',
    target: symbolName,
    matches: matchedSymbols,
    error: `Symbol "${symbolName}" is ambiguous; found ${matchedSymbols.length} definitions across files: ${matchedSymbols.map((m) => `${m.relativePath}:${m.startLine}`).join(', ')}`,
  };
}

/**
 * Resolves a list of explicit references.
 */
export async function resolveExplicitReferences(
  textOrRefs: string | ExplicitReference[],
  config: ServerConfig,
  adapter: WorkspaceViewAdapter,
): Promise<ResolveReferencesOutput> {
  const references =
    typeof textOrRefs === 'string'
      ? extractExplicitReferences(textOrRefs)
      : textOrRefs;

  const resolved: ResolvedReference[] = [];
  let totalResolved = 0;
  let totalAmbiguous = 0;
  let totalNotFound = 0;
  let totalErrors = 0;

  for (const ref of references) {
    if (ref.kind === 'file') {
      const res = await resolveFileReference(ref, config, adapter);
      resolved.push(res);
      if (res.status === 'resolved') totalResolved++;
      else if (res.status === 'not_found') totalNotFound++;
      else totalErrors++;
    } else if (ref.kind === 'symbol') {
      const res = await resolveSymbolReference(ref, config, adapter);
      resolved.push(res);
      if (res.status === 'resolved') totalResolved++;
      else if (res.status === 'ambiguous') totalAmbiguous++;
      else if (res.status === 'not_found') totalNotFound++;
      else totalErrors++;
    }
  }

  return {
    references: resolved,
    totalResolved,
    totalAmbiguous,
    totalNotFound,
    totalErrors,
  };
}
