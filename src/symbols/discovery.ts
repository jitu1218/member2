/**
 * ProofPatch MCP Server — Symbol Discovery Service
 *
 * Discovers and inspects code symbols across the workspace.
 * Specializes in Python AST with support for multi-language file routing.
 */

import path from 'node:path';
import type {
  ServerConfig,
  ToolError,
  WorkspaceViewAdapter,
} from '../types/index.js';
import {
  isBinaryFile,
  isSensitiveFile,
  resolveWorkspacePath,
  toRelativePath,
} from '../tools/path-utils.js';
import { parsePythonWithAst, type PythonAnalysisResult } from './python-ast.js';

export interface DiscoverSymbolsInput {
  /** Relative path to the target file */
  path: string;
}

export async function discoverSymbols(
  input: DiscoverSymbolsInput,
  config: ServerConfig,
  adapter: WorkspaceViewAdapter,
): Promise<PythonAnalysisResult | { error: ToolError }> {
  const resolved = resolveWorkspacePath(config.workspaceRoot, input.path);
  if ('error' in resolved) return resolved;

  const { absolutePath } = resolved;
  const relPath = toRelativePath(config.workspaceRoot, absolutePath);

  if (isSensitiveFile(relPath)) {
    return {
      error: {
        code: 'SENSITIVE_FILE',
        message: `File "${relPath}" matches a sensitive file pattern and cannot be parsed for symbols.`,
        path: relPath,
      },
    };
  }

  if (isBinaryFile(relPath)) {
    return {
      error: {
        code: 'BINARY_FILE',
        message: `File "${relPath}" is a binary file.`,
        path: relPath,
      },
    };
  }

  const stat = await adapter.fileStat(absolutePath);
  if (!stat || !stat.isFile) {
    return {
      error: {
        code: 'FILE_NOT_FOUND',
        message: `File not found: "${relPath}"`,
        path: relPath,
      },
    };
  }

  if (stat.size > config.maxFileSizeBytes) {
    return {
      error: {
        code: 'FILE_TOO_LARGE',
        message: `File "${relPath}" is too large to parse (${stat.size} bytes).`,
        path: relPath,
      },
    };
  }

  let content: string;
  try {
    content = await adapter.readFile(absolutePath);
  } catch (err) {
    return {
      error: {
        code: 'INTERNAL_ERROR',
        message: `Failed to read "${relPath}": ${String(err)}`,
        path: relPath,
      },
    };
  }

  const ext = path.extname(relPath).toLowerCase();
  if (ext === '.py') {
    return parsePythonWithAst(content, relPath);
  }

  // Unsupported or generic languages
  return {
    relativePath: relPath,
    language: ext.slice(1) || 'text',
    symbols: [],
    calls: [],
    analysisComplete: false,
    limitations: [
      `Deep AST symbol discovery currently targets Python (.py). Language "${ext || 'unknown'}" is not supported for full AST parsing.`,
    ],
  };
}
