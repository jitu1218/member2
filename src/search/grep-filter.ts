/**
 * ProofPatch MCP Server — grep-filter Utility
 *
 * Shared filtering logic for file and search tools:
 * - .gitignore parsing (simplified)
 * - Multi-pattern matching
 * - File-type classification
 */

import path from 'node:path';
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
export function parseGitignore(content: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];

  for (let line of content.split('\n')) {
    line = line.trim();

    // Skip empty lines and comments
    if (!line || line.startsWith('#')) continue;

    let negated = false;
    if (line.startsWith('!')) {
      negated = true;
      line = line.slice(1);
    }

    let directoryOnly = false;
    if (line.endsWith('/')) {
      directoryOnly = true;
      line = line.slice(0, -1);
    }

    // Strip leading slash (makes it anchored to root, but we match relative paths)
    const anchored = line.startsWith('/');
    if (anchored) {
      line = line.slice(1);
    }

    // Convert gitignore glob pattern to regex
    const regexStr = gitignorePatternToRegex(line, anchored);

    try {
      rules.push({
        pattern: line,
        negated,
        directoryOnly,
        regex: new RegExp(regexStr),
      });
    } catch {
      // Skip invalid patterns
    }
  }

  return rules;
}

/**
 * Check if a relative path is ignored by the given rules.
 */
export function isIgnoredByRules(
  relativePath: string,
  isDirectory: boolean,
  rules: IgnoreRule[],
): boolean {
  // Normalize to forward slashes
  const normalized = relativePath.replace(/\\/g, '/');

  let ignored = false;

  for (const rule of rules) {
    if (rule.directoryOnly && !isDirectory) continue;

    if (rule.regex.test(normalized)) {
      ignored = !rule.negated;
    }
  }

  return ignored;
}

/**
 * Load and parse .gitignore from the workspace root if it exists.
 */
export async function loadGitignore(
  workspaceRoot: string,
  adapter: WorkspaceViewAdapter,
): Promise<IgnoreRule[]> {
  const gitignorePath = path.join(workspaceRoot, '.gitignore');

  if (!(await adapter.fileExists(gitignorePath))) {
    return [];
  }

  try {
    const content = await adapter.readFile(gitignorePath);
    return parseGitignore(content);
  } catch {
    return [];
  }
}

/**
 * Classify a file by its extension for search relevance.
 */
export type FileCategory =
  | 'source'
  | 'test'
  | 'config'
  | 'documentation'
  | 'data'
  | 'style'
  | 'script'
  | 'other';

const SOURCE_EXTENSIONS = new Set([
  '.py', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.java', '.kt', '.go', '.rs', '.rb', '.php', '.c', '.cpp', '.h', '.hpp',
  '.cs', '.swift', '.scala', '.clj', '.ex', '.exs', '.erl',
]);

const TEST_PATTERNS = [
  /test[_s]?\./i,
  /\.test\./,
  /\.spec\./,
  /test_/,
  /_test\./,
  /tests\//,
  /spec\//,
  /__tests__\//,
];

const CONFIG_EXTENSIONS = new Set([
  '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
  '.xml', '.properties',
]);

const CONFIG_NAMES = new Set([
  'package.json', 'tsconfig.json', 'pyproject.toml', 'setup.py', 'setup.cfg',
  'Makefile', 'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
  '.eslintrc', '.prettierrc', 'jest.config.js', 'jest.config.ts',
  'webpack.config.js', 'vite.config.ts', 'rollup.config.js',
  'tox.ini', 'pytest.ini', 'mypy.ini', '.flake8',
]);

const DOC_EXTENSIONS = new Set([
  '.md', '.rst', '.txt', '.adoc', '.textile',
]);

export function classifyFile(relativePath: string): FileCategory {
  const ext = path.extname(relativePath).toLowerCase();
  const basename = path.basename(relativePath);

  // Check if test file
  if (TEST_PATTERNS.some((p) => p.test(relativePath))) return 'test';

  // Check known config names
  if (CONFIG_NAMES.has(basename)) return 'config';

  // Check by extension
  if (SOURCE_EXTENSIONS.has(ext)) return 'source';
  if (CONFIG_EXTENSIONS.has(ext)) return 'config';
  if (DOC_EXTENSIONS.has(ext)) return 'documentation';
  if (ext === '.css' || ext === '.scss' || ext === '.less' || ext === '.sass') return 'style';
  if (ext === '.sh' || ext === '.bash' || ext === '.ps1' || ext === '.bat' || ext === '.cmd') return 'script';
  if (ext === '.csv' || ext === '.tsv' || ext === '.sql') return 'data';

  return 'other';
}

// ─── Internal helpers ────────────────────────────────────────────

/**
 * Convert a gitignore glob pattern to a regex string.
 */
function gitignorePatternToRegex(pattern: string, anchored: boolean): string {
  let regex = '';

  // If not anchored and no slash, match basename anywhere in path
  const hasSlash = pattern.includes('/');
  if (!anchored && !hasSlash) {
    regex = '(?:^|/)';
  } else {
    regex = '^';
  }

  let i = 0;
  while (i < pattern.length) {
    const char = pattern[i];

    if (char === '*') {
      if (pattern[i + 1] === '*') {
        // ** = match any number of directories
        if (pattern[i + 2] === '/') {
          regex += '(?:.*/)?';
          i += 3;
        } else {
          regex += '.*';
          i += 2;
        }
      } else {
        // * = match anything except /
        regex += '[^/]*';
        i++;
      }
    } else if (char === '?') {
      regex += '[^/]';
      i++;
    } else if (char === '.') {
      regex += '\\.';
      i++;
    } else if (char === '/') {
      regex += '/';
      i++;
    } else if (char === '[') {
      // Handle character classes like [0-9] or [a-z] safely
      const closeIdx = pattern.indexOf(']', i + 1);
      if (closeIdx !== -1) {
        const inner = pattern.slice(i + 1, closeIdx);
        const escapedInner = inner.startsWith('!')
          ? '^' + inner.slice(1).replace(/[\\^$]/g, '\\$&')
          : inner.replace(/[\\^$]/g, '\\$&');
        regex += '[' + escapedInner + ']';
        i = closeIdx + 1;
      } else {
        regex += '\\[';
        i++;
      }
    } else if (/[+()^{}$|\\]/.test(char)) {
      // Escape literal regex metacharacters
      regex += '\\' + char;
      i++;
    } else {
      regex += char;
      i++;
    }
  }

  regex += '(?:$|/)';
  return regex;
}
