/**
 * ProofPatch MCP Server — list-files Tool
 *
 * Lists files within the workspace root, respecting ignore rules,
 * workspace boundaries, and exclusion patterns.
 */

import path from 'node:path';
import type {
  FileEntry,
  ListFilesInput,
  ListFilesOutput,
  ServerConfig,
  ToolError,
  WorkspaceViewAdapter,
} from '../types/index.js';
import {
  resolveWorkspacePath,
  isExcludedPath,
  toRelativePath,
} from './path-utils.js';
import {
  loadGitignore,
  isIgnoredByRules,
} from '../search/grep-filter.js';

const DEFAULT_MAX_RESULTS = 200;
const MAX_DEPTH = 15; // Safety limit to prevent infinite recursion

/**
 * List files within the workspace, respecting exclusion rules.
 */
export async function listFiles(
  input: ListFilesInput,
  config: ServerConfig,
  adapter: WorkspaceViewAdapter,
): Promise<ListFilesOutput | { error: ToolError }> {
  const maxResults = Math.min(input.maxResults ?? DEFAULT_MAX_RESULTS, 1000);

  // Determine the base directory
  let baseDir: string;
  if (input.directory) {
    const resolved = resolveWorkspacePath(config.workspaceRoot, input.directory);
    if ('error' in resolved) return resolved;
    baseDir = resolved.absolutePath;
  } else {
    baseDir = path.resolve(config.workspaceRoot);
  }

  // Verify the base directory exists and is a directory
  const baseStat = await adapter.fileStat(baseDir);
  if (!baseStat) {
    return {
      error: {
        code: 'FILE_NOT_FOUND',
        message: `Directory not found: "${input.directory ?? '.'}"`,
        path: input.directory ?? '.',
      },
    };
  }
  if (!baseStat.isDirectory) {
    return {
      error: {
        code: 'INVALID_INPUT',
        message: `Path is not a directory: "${input.directory ?? '.'}"`,
        path: input.directory ?? '.',
      },
    };
  }

  // Build the glob/extension filter if provided
  const patternFilter = input.pattern
    ? buildPatternMatcher(input.pattern)
    : undefined;

  const files: FileEntry[] = [];
  let totalFound = 0;
  let excludedCount = 0;

  // Load workspace .gitignore rules if present
  const gitignoreRules = await loadGitignore(config.workspaceRoot, adapter);

  // Recursive directory walker
  async function walk(dirPath: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return;
    if (files.length >= maxResults) return;

    let entries: string[];
    try {
      entries = await adapter.readDirectory(dirPath);
    } catch {
      // Permission denied or unreadable — skip silently
      return;
    }

    // Sort for deterministic output
    entries.sort();

    for (const entry of entries) {
      if (files.length >= maxResults) break;

      const entryPath = path.join(dirPath, entry);
      const relPath = toRelativePath(config.workspaceRoot, entryPath);

      // Skip hidden files unless explicitly requested
      if (!input.includeHidden && entry.startsWith('.')) {
        excludedCount++;
        continue;
      }

      // Check exclusion patterns
      if (isExcludedPath(relPath, config.additionalExcludePaths)) {
        excludedCount++;
        continue;
      }

      let stat: Awaited<ReturnType<WorkspaceViewAdapter['fileStat']>>;
      try {
        stat = await adapter.fileStat(entryPath);
      } catch {
        continue;
      }

      if (!stat) continue;

      // Check workspace .gitignore rules
      if (isIgnoredByRules(relPath, stat.isDirectory, gitignoreRules)) {
        excludedCount++;
        continue;
      }

      if (stat.isDirectory) {
        // Recurse into subdirectory
        await walk(entryPath, depth + 1);
      } else if (stat.isFile) {
        const ext = path.extname(entry).toLowerCase();

        // Apply pattern filter
        if (patternFilter && !patternFilter(relPath, entry)) {
          continue;
        }

        totalFound++;
        files.push({
          relativePath: relPath,
          extension: ext || '',
          sizeBytes: stat.size,
          isDirectory: false,
        });
      }
    }
  }

  await walk(baseDir, 0);

  return {
    workspaceRoot: config.workspaceRoot,
    files,
    totalFound,
    truncated: totalFound > maxResults || files.length >= maxResults,
    excludedCount,
  };
}

/**
 * Build a simple pattern matcher from a glob-like pattern.
 * Supports:
 *   "*.py"        → extension match
 *   "**\/*.py"    → extension match anywhere
 *   "tests/"      → prefix match
 *   "test_*"      → prefix + wildcard
 */
function buildPatternMatcher(
  pattern: string,
): (relPath: string, basename: string) => boolean {
  // Extension filter: "*.py" or "**/*.py"
  const extMatch = pattern.match(/^\*\*?\/?\*(\.\w+)$/);
  if (extMatch) {
    const ext = extMatch[1].toLowerCase();
    return (_relPath, basename) =>
      basename.toLowerCase().endsWith(ext);
  }

  // Simple extension: "*.py"
  if (pattern.startsWith('*.')) {
    const ext = pattern.slice(1).toLowerCase();
    return (_relPath, basename) =>
      basename.toLowerCase().endsWith(ext);
  }

  // Directory prefix: "tests/" or "tests"
  if (pattern.endsWith('/') || !pattern.includes('*')) {
    const prefix = pattern.replace(/\/+$/, '');
    return (relPath) =>
      relPath.startsWith(prefix + '/') || relPath === prefix;
  }

  // General wildcard: convert to regex
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
