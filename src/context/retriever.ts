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

import path from 'node:path';
import type {
  AutoContextOutput,
  ContextItem,
  SelectionReason,
  ServerConfig,
  WorkspaceViewAdapter,
} from '../types/index.js';
import { listFiles } from '../tools/list-files.js';
import { readFile } from '../tools/read-file.js';
import { textSearch } from '../search/text-search.js';
import { discoverSymbols } from '../symbols/discovery.js';
import { resolveExplicitReferences } from './references.js';
import { classifyFile } from '../search/grep-filter.js';

export interface RetrieveContextInput {
  /** The natural language user prompt or instruction */
  prompt: string;

  /** Optional budget in characters (defaults to config.contextBudgetChars) */
  budgetChars?: number;

  /** Optional limit on number of files to select (default: 5) */
  maxFiles?: number;
}

interface RankedCandidate {
  relativePath: string;
  score: number;
  reasons: { reason: SelectionReason; evidence: string; weight: number }[];
  sizeChars: number;
  symbol?: string;
  startLine?: number;
  endLine?: number;
}

export async function retrieveContext(
  input: RetrieveContextInput,
  config: ServerConfig,
  adapter: WorkspaceViewAdapter,
): Promise<AutoContextOutput> {
  const budgetChars = input.budgetChars ?? config.contextBudgetChars;
  const maxFiles = input.maxFiles ?? 5;
  const methodsUsed: string[] = [];
  const limitations: string[] = [];

  const candidatesMap = new Map<string, RankedCandidate>();

  function addEvidence(
    relPath: string,
    reason: SelectionReason,
    evidence: string,
    weight: number,
    extra?: { symbol?: string; startLine?: number; endLine?: number; sizeChars?: number },
  ) {
    let candidate = candidatesMap.get(relPath);
    if (!candidate) {
      candidate = {
        relativePath: relPath,
        score: 0,
        reasons: [],
        sizeChars: extra?.sizeChars ?? 0,
        symbol: extra?.symbol,
        startLine: extra?.startLine,
        endLine: extra?.endLine,
      };
      candidatesMap.set(relPath, candidate);
    }
    candidate.score += weight;
    candidate.reasons.push({ reason, evidence, weight });
    if (extra?.symbol && !candidate.symbol) candidate.symbol = extra.symbol;
    if (extra?.startLine && !candidate.startLine) candidate.startLine = extra.startLine;
    if (extra?.endLine && !candidate.endLine) candidate.endLine = extra.endLine;
    if (extra?.sizeChars && candidate.sizeChars === 0) candidate.sizeChars = extra.sizeChars;
  }

  // ── Step 1: Explicit References (@file, @symbol) ─────────────────
  methodsUsed.push('explicit_references');
  const explicitRefs = await resolveExplicitReferences(input.prompt, config, adapter);
  for (const ref of explicitRefs.references) {
    if (ref.status === 'resolved') {
      if (ref.kind === 'file' && ref.relativePath) {
        addEvidence(
          ref.relativePath,
          'explicit_reference',
          `Explicitly requested via ${ref.raw}`,
          1000,
          { sizeChars: ref.sizeBytes ?? ref.content?.length ?? 0 },
        );
      } else if (ref.kind === 'symbol' && ref.selectedMatch) {
        const sym = ref.selectedMatch;
        addEvidence(
          sym.relativePath,
          'explicit_reference',
          `Explicitly requested symbol "${sym.name}" via ${ref.raw}`,
          1000,
          {
            symbol: sym.name,
            startLine: sym.startLine,
            endLine: sym.endLine,
            sizeChars: (sym.endLine - sym.startLine + 1) * 60,
          },
        );
      }
    }
  }

  // ── Step 2: Extract Query Keywords / Identifiers ──────────────────
  const keywords = extractKeywords(input.prompt);

  // ── Step 3: Workspace File Listing & Path Matching ───────────────
  methodsUsed.push('path_relevance');
  const listRes = await listFiles({ maxResults: 1000 }, config, adapter);
  if (!('error' in listRes)) {
    const configTriggerKeywords = new Set([
      'config', 'configuration', 'settings', 'setting', 'json', 'yaml', 'yml',
      'toml', 'env', 'secret', 'password', 'key', 'token', 'setup',
    ]);
    const taskInvolvesConfig = keywords.some((k) =>
      configTriggerKeywords.has(k.toLowerCase()),
    );

    for (const file of listRes.files) {
      const p = file.relativePath.toLowerCase();
      for (const kw of keywords) {
        if (p.includes(kw.toLowerCase())) {
          addEvidence(
            file.relativePath,
            'path_relevance',
            `File path matches keyword "${kw}"`,
            40,
            { sizeChars: file.sizeBytes },
          );
        }
      }

      // Detect relevant configuration files
      if (classifyFile(file.relativePath) === 'config') {
        const base = path.basename(file.relativePath).toLowerCase();
        const directMatch = keywords.some((kw) => base.includes(kw.toLowerCase()));
        if (directMatch || taskInvolvesConfig) {
          addEvidence(
            file.relativePath,
            'config_file',
            `Configuration file matching task requirements ("${file.relativePath}")`,
            directMatch ? 65 : 45,
            { sizeChars: file.sizeBytes },
          );
        }
      }
    }
  }

  // ── Step 4: Lexical Code Search ──────────────────────────────────
  methodsUsed.push('text_search');
  for (const kw of keywords.slice(0, 4)) {
    const searchRes = await textSearch(
      { query: kw, maxResults: 15 },
      config,
      adapter,
    );
    if (!('error' in searchRes)) {
      for (const match of searchRes.matches) {
        addEvidence(
          match.relativePath,
          'text_match',
          `Contains search term "${kw}" at line ${match.lineNumber}: "${match.lineContent.trim()}"`,
          30,
        );
      }
    }
  }

  // ── Step 5: Symbol Definitions (for top candidate files) ─────────
  methodsUsed.push('symbol_definitions');
  const preliminaryCandidates = Array.from(candidatesMap.keys()).slice(0, 10);
  const discoveredSymbolsByFile = new Map<
    string,
    { symbols: any[]; calls: any[] }
  >();

  for (const file of preliminaryCandidates) {
    if (file.endsWith('.py')) {
      const symRes = await discoverSymbols({ path: file }, config, adapter);
      if (!('error' in symRes)) {
        discoveredSymbolsByFile.set(file, {
          symbols: symRes.symbols,
          calls: symRes.calls,
        });

        for (const sym of symRes.symbols) {
          for (const kw of keywords) {
            if (sym.name.toLowerCase().includes(kw.toLowerCase())) {
              if (sym.kind === 'import') {
                addEvidence(
                  file,
                  'import_reference',
                  `Imports matching identifier "${sym.name}" (from "${sym.importSource || 'module'}")`,
                  70,
                );
              } else {
                addEvidence(
                  file,
                  'symbol_definition',
                  `Defines matching ${sym.kind} "${sym.name}" (lines ${sym.startLine}-${sym.endLine})`,
                  80,
                  { symbol: sym.name, startLine: sym.startLine, endLine: sym.endLine },
                );
              }
            }
          }
        }
      }
    }
  }

  // ── Step 5b: Trace Imports (import_reference) ─────────────────────
  methodsUsed.push('import_references');
  for (const [sourceFile, analysis] of discoveredSymbolsByFile.entries()) {
    for (const sym of analysis.symbols) {
      if (sym.kind === 'import') {
        const importSrc = (sym.importSource || sym.name).toLowerCase();
        for (const otherFile of preliminaryCandidates) {
          if (otherFile === sourceFile) continue;
          const otherBase = path.basename(otherFile, path.extname(otherFile)).toLowerCase();
          if (importSrc.endsWith(otherBase) || importSrc.includes(`.${otherBase}`)) {
            addEvidence(
              otherFile,
              'import_reference',
              `Imported by "${sourceFile}" via "${sym.importSource || sym.name}"`,
              70,
            );
          }
        }
      }
    }
  }

  // ── Step 5c: Trace Call Sites (likely_caller) ─────────────────────
  methodsUsed.push('call_relationships');
  for (const [sourceFile, analysis] of discoveredSymbolsByFile.entries()) {
    for (const call of analysis.calls) {
      for (const [targetFile, targetAnalysis] of discoveredSymbolsByFile.entries()) {
        if (targetFile === sourceFile) continue;
        const matchingDef = targetAnalysis.symbols.find(
          (s: any) => (s.kind === 'function' || s.kind === 'method') && s.name === call.name,
        );
        if (matchingDef) {
          addEvidence(
            sourceFile,
            'likely_caller',
            `Likely caller: invokes "${call.name}()" at line ${call.startLine} (defined in "${targetFile}")`,
            75,
          );
        }
      }
    }
  }

  // ── Step 6: Test Association ─────────────────────────────────────
  methodsUsed.push('test_association');
  const currentFiles = Array.from(candidatesMap.keys());
  if (!('error' in listRes)) {
    for (const file of currentFiles) {
      const baseName = path.basename(file, path.extname(file));
      // Locate corresponding test file (e.g. test_cli.py for cli.py)
      const matchingTest = listRes.files.find(
        (f) =>
          f.relativePath.toLowerCase().includes(`test_${baseName.toLowerCase()}`) ||
          f.relativePath.toLowerCase().includes(`${baseName.toLowerCase()}_test`),
      );
      if (matchingTest) {
        addEvidence(
          matchingTest.relativePath,
          'test_file',
          `Associated test suite for "${file}"`,
          60,
          { sizeChars: matchingTest.sizeBytes },
        );
      }
    }
  }

  // ── Step 7: Rank and Select within Budget ─────────────────────────
  const sorted = Array.from(candidatesMap.values()).sort(
    (a, b) => b.score - a.score,
  );

  const selected: ContextItem[] = [];
  const excluded: ContextItem[] = [];
  const contextPieces: AutoContextOutput['contextPieces'] = [];

  let usedChars = 0;

  for (const candidate of sorted) {
    // Read snippet or full file
    let contentToInclude = '';
    const readRes = await readFile(
      {
        path: candidate.relativePath,
        startLine: candidate.startLine,
        endLine: candidate.endLine,
      },
      config,
      adapter,
    );

    if (!('error' in readRes)) {
      contentToInclude = readRes.content;
      candidate.sizeChars = contentToInclude.length;
    } else {
      // If reading range failed or had error, fall back to whole file stat or estimate
      if (candidate.sizeChars === 0) candidate.sizeChars = 500;
    }

    // Prioritize highest-weighted reason as the primary reason
    const sortedReasons = [...candidate.reasons].sort((a, b) => b.weight - a.weight);
    const primaryReason = sortedReasons[0]?.reason ?? 'text_match';
    const evidenceSummary = sortedReasons.map((r) => r.evidence).join('; ');

    const item: ContextItem = {
      relativePath: candidate.relativePath,
      symbol: candidate.symbol,
      startLine: candidate.startLine,
      endLine: candidate.endLine,
      reason: primaryReason,
      evidence: evidenceSummary,
      sizeChars: candidate.sizeChars,
    };

    if (
      selected.length < maxFiles &&
      usedChars + candidate.sizeChars <= budgetChars &&
      contentToInclude.length > 0
    ) {
      selected.push(item);
      usedChars += candidate.sizeChars;
      contextPieces.push({
        relativePath: candidate.relativePath,
        symbol: candidate.symbol,
        startLine: candidate.startLine,
        endLine: candidate.endLine,
        content: contentToInclude,
        reason: primaryReason,
        evidence: evidenceSummary,
      });
    } else {
      let omissionReason = '';
      if (selected.length >= maxFiles) {
        omissionReason = `Exceeded maxFiles limit of ${maxFiles}.`;
      } else if (usedChars + candidate.sizeChars > budgetChars) {
        omissionReason = `Exceeded context character budget (needs ${candidate.sizeChars} chars, remaining: ${budgetChars - usedChars} chars).`;
      } else {
        omissionReason = 'Omitted due to empty or unreadable content.';
      }

      excluded.push({
        ...item,
        evidence: `${evidenceSummary} [OMITTED: ${omissionReason}]`,
      });
    }
  }

  limitations.push(
    'Automatic context retrieval is heuristic and ranked by lexical, structural, and test association signals.',
  );
  if (candidatesMap.size === 0) {
    limitations.push(
      'No candidate files matched the prompt terms. Consider using explicit @file or @symbol tags.',
    );
  }

  return {
    contextPieces,
    evidenceTrail: {
      selected,
      excluded,
      budgetChars,
      usedChars,
      methods: methodsUsed,
      limitations,
    },
  };
}

/**
 * Extracts salient keywords/identifiers from a user prompt.
 * Filters out common stop words, punctuation, and short tokens.
 */
function extractKeywords(prompt: string): string[] {
  // Remove @directives so they don't pollute keywords
  const cleaned = prompt.replace(/@(file|symbol):[^\s]+/g, '');

  const tokens = cleaned
    .split(/[^A-Za-z0-9_]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);

  const STOP_WORDS = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'make',
    'change', 'update', 'modify', 'please', 'add', 'create', 'build',
    'tests', 'test', 'files', 'file', 'code', 'into', 'when', 'should',
    'which', 'where', 'also', 'about', 'need', 'want', 'look', 'find',
  ]);

  const unique = Array.from(new Set(tokens.filter((t) => !STOP_WORDS.has(t.toLowerCase()))));
  return unique;
}
