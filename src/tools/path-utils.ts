/**
 * ProofPatch MCP Server — Path Safety Utilities
 *
 * All path resolution, validation, and safety checks for workspace tools.
 * Prevents path traversal and workspace escape.
 */

import path from 'node:path';
import {
  BINARY_EXTENSIONS,
  DEFAULT_EXCLUDE_PATTERNS,
  SENSITIVE_FILE_PATTERNS,
  type ToolError,
} from '../types/index.js';

/**
 * Resolve a user-provided relative path to an absolute path within
 * the workspace, returning an error if the resolved path escapes.
 */
export function resolveWorkspacePath(
  workspaceRoot: string,
  relativePath: string,
): { absolutePath: string } | { error: ToolError } {
  // Reject empty paths
  if (!relativePath || relativePath.trim() === '') {
    return {
      error: {
        code: 'INVALID_INPUT',
        message: 'Path must not be empty.',
        path: relativePath,
      },
    };
  }

  // Normalize both root and the requested path
  const normalizedRoot = path.resolve(workspaceRoot);

  // Strip any leading slashes to treat as relative
  let cleanPath = relativePath.replace(/^[/\\]+/, '');

  // Resolve relative to workspace root
  const resolved = path.resolve(normalizedRoot, cleanPath);

  // Ensure resolved path is within workspace root
  // Use normalizedRoot + path.sep to avoid prefix matching issues
  // e.g., /workspace-other should not match /workspace
  const rootPrefix = normalizedRoot.endsWith(path.sep)
    ? normalizedRoot
    : normalizedRoot + path.sep;

  if (resolved !== normalizedRoot && !resolved.startsWith(rootPrefix)) {
    return {
      error: {
        code: 'PATH_OUTSIDE_WORKSPACE',
        message: `Path "${relativePath}" resolves outside the workspace root.`,
        path: relativePath,
        details: `Resolved to "${resolved}" which is outside "${normalizedRoot}".`,
      },
    };
  }

  return { absolutePath: resolved };
}

/**
 * Check if a path contains traversal sequences like ".." that
 * attempt to escape the workspace.
 */
export function hasTraversalAttempt(inputPath: string): boolean {
  const segments = inputPath.split(/[/\\]/);
  return segments.some((seg) => seg === '..');
}

/**
 * Check if a file path matches sensitive file patterns.
 */
export function isSensitiveFile(filePath: string): boolean {
  const basename = path.basename(filePath);
  const lowerBasename = basename.toLowerCase();

  for (const pattern of SENSITIVE_FILE_PATTERNS) {
    if (pattern.startsWith('*.')) {
      // Extension match
      const ext = pattern.slice(1); // e.g., ".pem"
      if (lowerBasename.endsWith(ext.toLowerCase())) {
        return true;
      }
    } else if (pattern.includes('*')) {
      // Simple wildcard match (e.g., ".env.*", "service-account*.json")
      const regex = new RegExp(
        '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$',
        'i'
      );
      if (regex.test(lowerBasename)) {
        return true;
      }
    } else {
      // Exact match
      if (lowerBasename === pattern.toLowerCase()) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if a file has a binary extension.
 */
export function isBinaryFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * Check if a path segment or file matches default exclude patterns.
 */
export function isExcludedPath(
  relativePath: string,
  additionalExcludes: string[] = [],
): boolean {
  const allPatterns = [...DEFAULT_EXCLUDE_PATTERNS, ...additionalExcludes];
  const segments = relativePath.split(/[/\\]/);
  const basename = path.basename(relativePath);

  for (const pattern of allPatterns) {
    if (pattern.startsWith('*.')) {
      // Extension wildcard: match the file's basename
      const ext = pattern.slice(1);
      if (basename.toLowerCase().endsWith(ext.toLowerCase())) {
        return true;
      }
    } else if (pattern.endsWith('*')) {
      // Suffix wildcard on the end
      const prefix = pattern.slice(0, -1);
      if (segments.some((seg) => seg.toLowerCase().startsWith(prefix.toLowerCase()))) {
        return true;
      }
    } else if (pattern.includes('*')) {
      // General glob-like pattern — match against basename
      const regex = new RegExp(
        '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$',
        'i'
      );
      if (regex.test(basename)) {
        return true;
      }
    } else {
      // Exact directory or file name match against any path segment
      if (segments.some((seg) => seg === pattern)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Get the relative path from workspace root.
 */
export function toRelativePath(workspaceRoot: string, absolutePath: string): string {
  return path.relative(path.resolve(workspaceRoot), absolutePath).replace(/\\/g, '/');
}
