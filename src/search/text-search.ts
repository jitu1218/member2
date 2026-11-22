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

import { spawn } from 'node:child_process';
import path from 'node:path';
import type {
  SearchMatch,
  ServerConfig,
  TextSearchInput,
  TextSearchOutput,
  ToolError,
  WorkspaceViewAdapter,
} from '../types/index.js';
import {
  isExcludedPath,
  isBinaryFile,
  isSensitiveFile,
  toRelativePath,
} from '../tools/path-utils.js';
import {
  loadGitignore,
  isIgnoredByRules,
} from './grep-filter.js';

/**
 * Search for text within the workspace.
 * Tries ripgrep first; falls back to Node.js walker.
 */
export async function textSearch(
  input: TextSearchInput,
  config: ServerConfig,
  adapter: WorkspaceViewAdapter,
): Promise<TextSearchOutput | { error: ToolError }> {
  // ── Validate input ───────────────────────────────────────────
  if (!input.query || input.query.trim() === '') {
    return {
      error: {
        code: 'INVALID_INPUT',
        message: 'Search query must not be empty.',
      },
    };
  }

  if (input.isRegex) {
    try {
      new RegExp(input.query);
    } catch {
      return {
        error: {
          code: 'INVALID_INPUT',
          message: `Invalid regex pattern: "${input.query}"`,
          details: 'The query was flagged as regex but is not a valid regular expression.',
        },
      };
    }
  }

  const maxResults = Math.min(input.maxResults ?? config.maxSearchResults, 500);
  const contextLines = Math.min(input.contextLines ?? config.searchContextLines, 5);

  // ── Try ripgrep first (only when no in-memory staged overlay is active) ─
  const hasOverlay =
    typeof adapter.hasStagedChanges === 'function' && adapter.hasStagedChanges();

  if (!hasOverlay) {
    const rgResult = await tryRipgrep(input, config, maxResults, contextLines);
    if (rgResult !== null) {
      return rgResult;
    }
  }

  // ── Fall back to Node.js search (always used when staged changes exist) ─
  return nodeSearch(input, config, adapter, maxResults, contextLines);
}

// ═══════════════════════════════════════════════════════════════════
// Ripgrep search
// ═══════════════════════════════════════════════════════════════════

/** Check if ripgrep is available. Result is cached. */
let rgAvailable: boolean | null = null;

async function isRipgrepAvailable(): Promise<boolean> {
  if (rgAvailable !== null) return rgAvailable;

  return new Promise((resolve) => {
    const proc = spawn('rg', ['--version'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    });
    proc.on('error', () => {
      rgAvailable = false;
      resolve(false);
    });
    proc.on('close', (code) => {
      rgAvailable = code === 0;
      resolve(rgAvailable);
    });
  });
}

/**
 * Try searching with ripgrep. Returns null if rg is not available.
 */
async function tryRipgrep(
  input: TextSearchInput,
  config: ServerConfig,
  maxResults: number,
  contextLines: number,
): Promise<TextSearchOutput | { error: ToolError } | null> {
  if (!(await isRipgrepAvailable())) return null;

  const args: string[] = [
    '--json',
    '--max-count', String(maxResults),
    '--context', String(contextLines),
    '--max-filesize', `${config.maxFileSizeBytes}b`,
  ];

  if (!input.caseSensitive) args.push('--ignore-case');
  if (!input.isRegex) args.push('--fixed-strings');

  if (input.filePattern) {
    args.push('--glob', input.filePattern);
  }

  args.push('--', input.query, '.');

  return new Promise((resolve) => {
    const proc = spawn('rg', args, {
      cwd: config.workspaceRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: config.searchTimeoutMs,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('error', () => {
      rgAvailable = false;
      resolve(null); // fall back to node search
    });

    proc.on('close', (code) => {
      if (code !== null && code > 1) {
        // rg exits 1 on no matches, >1 on error
        resolve({
          error: {
            code: 'INTERNAL_ERROR',
            message: `ripgrep failed: ${stderr.trim() || 'unknown error'}`,
          },
        });
        return;
      }

      const matches = parseRipgrepJson(stdout, config.workspaceRoot, maxResults, contextLines);
      resolve({
        query: input.query,
        matches: matches.items,
        totalMatches: matches.total,
        truncated: matches.total > maxResults,
        filesSearched: matches.filesSearched,
        durationMs: 0, // rg doesn't report this per-search
      });
    });
  });
}

/** Parse ripgrep JSON output lines into SearchMatch[] with context lines */
function parseRipgrepJson(
  stdout: string,
  workspaceRoot: string,
  maxResults: number,
  contextLines: number,
): { items: SearchMatch[]; total: number; filesSearched: number } {
  const items: SearchMatch[] = [];
  const files = new Set<string>();
  let total = 0;
  let summaryFilesSearched = 0;

  let currentFile: string | null = null;
  const pendingContextBefore: string[] = [];
  let lastMatchForContextAfter: SearchMatch | null = null;

  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);

      if (obj.type === 'begin') {
        const absPath = obj.data?.path?.text ?? '';
        currentFile = toRelativePath(workspaceRoot, path.resolve(workspaceRoot, absPath));
        files.add(currentFile);
        pendingContextBefore.length = 0;
        lastMatchForContextAfter = null;
      } else if (obj.type === 'context') {
        const lineText = (obj.data?.lines?.text ?? '').replace(/\r?\n$/, '');
        const absPath = obj.data?.path?.text ?? '';
        const relPath = toRelativePath(workspaceRoot, path.resolve(workspaceRoot, absPath));
        files.add(relPath);

        if (
          lastMatchForContextAfter &&
          lastMatchForContextAfter.relativePath === relPath &&
          lastMatchForContextAfter.contextAfter.length < contextLines
        ) {
          lastMatchForContextAfter.contextAfter.push(lineText);
        } else {
          pendingContextBefore.push(lineText);
          if (pendingContextBefore.length > contextLines) {
            pendingContextBefore.shift();
          }
        }
      } else if (obj.type === 'match') {
        total++;
        const data = obj.data;
        const absPath = data?.path?.text ?? '';
        const relPath = toRelativePath(workspaceRoot, path.resolve(workspaceRoot, absPath));
        files.add(relPath);

        if (items.length < maxResults) {
          if (!isSensitiveFile(relPath)) {
            const matchItem: SearchMatch = {
              relativePath: relPath,
              lineNumber: data.line_number ?? 0,
              lineContent: (data.lines?.text ?? '').replace(/\r?\n$/, ''),
              contextBefore: [...pendingContextBefore],
              contextAfter: [],
            };
            items.push(matchItem);
            lastMatchForContextAfter = matchItem;
          }
        }
        pendingContextBefore.length = 0;
      } else if (obj.type === 'end') {
        pendingContextBefore.length = 0;
        lastMatchForContextAfter = null;
      } else if (obj.type === 'summary') {
        summaryFilesSearched = obj.data?.stats?.searched_files ?? 0;
      }
    } catch {
      // Skip unparseable lines
    }
  }

  const finalFilesSearched = summaryFilesSearched > 0 ? summaryFilesSearched : files.size;
  return { items, total, filesSearched: finalFilesSearched };
}

// ═══════════════════════════════════════════════════════════════════
// Node.js fallback search
// ═══════════════════════════════════════════════════════════════════

/**
 * Pure Node.js text search — walks the file tree and matches line by line.
 */
async function nodeSearch(
  input: TextSearchInput,
  config: ServerConfig,
  adapter: WorkspaceViewAdapter,
  maxResults: number,
  contextLines: number,
): Promise<TextSearchOutput | { error: ToolError }> {
  const startTime = Date.now();
  const deadline = startTime + config.searchTimeoutMs;

  // Build the matcher
  const flags = input.caseSensitive ? '' : 'i';
  let regex: RegExp;
  try {
    regex = input.isRegex
      ? new RegExp(input.query, flags)
      : new RegExp(escapeRegExp(input.query), flags);
  } catch {
    return {
      error: {
        code: 'INVALID_INPUT',
        message: `Invalid search pattern: "${input.query}"`,
      },
    };
  }

  // Build glob/extension filter
  const fileFilter = input.filePattern
    ? buildFileFilter(input.filePattern)
    : undefined;

  const matches: SearchMatch[] = [];
  let totalMatches = 0;
  let filesSearched = 0;
  let timedOut = false;

  // Collect all candidate files first (bounded walk)
  const candidateFiles = await collectFiles(
    config.workspaceRoot,
    config,
    adapter,
    fileFilter,
    deadline,
  );

  // Search each file
  for (const filePath of candidateFiles) {
    if (Date.now() > deadline) {
      timedOut = true;
      break;
    }

    if (matches.length >= maxResults) break;

    // Skip binary files
    if (isBinaryFile(filePath)) continue;

    // Skip sensitive files
    const relPath = toRelativePath(config.workspaceRoot, filePath);
    if (isSensitiveFile(relPath)) continue;

    // Check file size
    const stat = await adapter.fileStat(filePath);
    if (!stat || !stat.isFile || stat.size > config.maxFileSizeBytes) continue;

    // Read and search
    let content: string;
    try {
      content = await adapter.readFile(filePath);
    } catch {
      continue; // Permission denied, etc.
    }

    filesSearched++;

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        totalMatches++;

        if (matches.length < maxResults) {
          // Gather context lines
          const ctxBefore: string[] = [];
          const ctxAfter: string[] = [];
          for (let b = Math.max(0, i - contextLines); b < i; b++) {
            ctxBefore.push(lines[b]);
          }
          for (let a = i + 1; a <= Math.min(lines.length - 1, i + contextLines); a++) {
            ctxAfter.push(lines[a]);
          }

          matches.push({
            relativePath: relPath,
            lineNumber: i + 1, // 1-based
            lineContent: lines[i],
            contextBefore: ctxBefore,
            contextAfter: ctxAfter,
          });
        }
      }
    }
  }

  const durationMs = Date.now() - startTime;

  const result: TextSearchOutput = {
    query: input.query,
    matches,
    totalMatches,
    truncated: totalMatches > maxResults || timedOut,
    filesSearched,
    durationMs,
  };

  return result;
}

/**
 * Recursively collect file paths that pass exclusion and filter checks.
 * Respects workspace boundaries, exclusion rules, and the deadline.
 */
async function collectFiles(
  rootDir: string,
  config: ServerConfig,
  adapter: WorkspaceViewAdapter,
  fileFilter: ((relPath: string, basename: string) => boolean) | undefined,
  deadline: number,
  maxFiles: number = 10_000,
): Promise<string[]> {
  const files: string[] = [];
  const MAX_DEPTH = 15;

  // Load workspace .gitignore rules if present
  const gitignoreRules = await loadGitignore(config.workspaceRoot, adapter);

  async function walk(dirPath: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return;
    if (files.length >= maxFiles) return;
    if (Date.now() > deadline) return;

    let entries: string[];
    try {
      entries = await adapter.readDirectory(dirPath);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= maxFiles || Date.now() > deadline) break;

      const entryPath = path.join(dirPath, entry);
      const relPath = toRelativePath(config.workspaceRoot, entryPath);

      // Skip hidden entries
      if (entry.startsWith('.')) continue;

      // Check exclusion patterns
      if (isExcludedPath(relPath, config.additionalExcludePaths)) continue;

      let stat: Awaited<ReturnType<WorkspaceViewAdapter['fileStat']>>;
      try {
        stat = await adapter.fileStat(entryPath);
      } catch {
        continue;
      }

      if (!stat) continue;

      // Check workspace .gitignore rules
      if (isIgnoredByRules(relPath, stat.isDirectory, gitignoreRules)) continue;

      if (stat.isDirectory) {
        await walk(entryPath, depth + 1);
      } else if (stat.isFile) {
        // Apply file filter if provided
        if (fileFilter && !fileFilter(relPath, entry)) continue;
        files.push(entryPath);
      }
    }
  }

  await walk(rootDir, 0);
  return files;
}

/**
 * Build a file filter function from a glob-like pattern.
 */
function buildFileFilter(
  pattern: string,
): (relPath: string, basename: string) => boolean {
  // Extension filter: "*.py"
  if (pattern.startsWith('*.')) {
    const ext = pattern.slice(1).toLowerCase();
    return (_relPath, basename) =>
      basename.toLowerCase().endsWith(ext);
  }

  // Double-star extension: "**/*.py"
  const extMatch = pattern.match(/^\*\*\/?\*(\.\w+)$/);
  if (extMatch) {
    const ext = extMatch[1].toLowerCase();
    return (_relPath, basename) =>
      basename.toLowerCase().endsWith(ext);
  }

  // Directory prefix: "tests/" or "src/tests/"
  if (pattern.endsWith('/') || (!pattern.includes('*') && !pattern.includes('.'))) {
    const prefix = pattern.replace(/\/+$/, '');
    return (relPath) =>
      relPath.startsWith(prefix + '/') || relPath === prefix;
  }

  // General wildcard → regex
  const regex = new RegExp(
    '^' +
      pattern
        .replace(/\./g, '\\.')
        .replace(/\*\*/g, '<<GLOBSTAR>>')
        .replace(/\*/g, '[^/]*')
        .replace(/<<GLOBSTAR>>/g, '.*') +
      '$',
    'i',
  );
  return (relPath) => regex.test(relPath);
}

/** Escape special regex characters in a string for literal matching. */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ═══════════════════════════════════════════════════════════════════
// Export internals for testing
// ═══════════════════════════════════════════════════════════════════

export { escapeRegExp, buildFileFilter, collectFiles };
