/**
 * ProofPatch MCP Server — TrueForge Registration Helper
 *
 * Provides TrueForge integration configuration and definitions for Member 1.
 * Member 1's agent harness can either:
 *  1. Launch this server via stdio as an external MCP server:
 *     { command: "node", args: ["<path>/mcp-server/dist/index.js", "<workspaceRoot>"] }
 *  2. Register tools in-process using `getMcpToolDefinitions()`.
 */

import type { ServerConfig, WorkspaceViewAdapter } from './types/index.js';
import { DEFAULT_CONFIG } from './types/index.js';
import { FilesystemAdapter } from './tools/fs-adapter.js';
import { listFiles } from './tools/list-files.js';
import { readFile } from './tools/read-file.js';
import { textSearch } from './search/text-search.js';
import { discoverSymbols } from './symbols/discovery.js';
import { resolveExplicitReferences } from './context/references.js';
import { retrieveContext } from './context/retriever.js';

export interface TrueForgeToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: any) => Promise<any>;
}

/**
 * Returns in-process tool definitions for direct integration with Member 1's TrueForge harness.
 */
export function getTrueForgeTools(
  configOverrides?: Partial<ServerConfig>,
  customAdapter?: WorkspaceViewAdapter,
): TrueForgeToolDefinition[] {
  const config: ServerConfig = { ...DEFAULT_CONFIG, ...configOverrides };
  const adapter = customAdapter || new FilesystemAdapter();

  return [
    {
      name: 'list_files',
      description:
        'List files in the workspace directory. Respects .gitignore-style rules, skips node_modules, build outputs, and hidden files by default.',
      parameters: {
        type: 'object',
        properties: {
          directory: { type: 'string', description: 'Subdirectory to list (relative to workspace root).' },
          pattern: { type: 'string', description: 'File pattern filter, e.g. "*.py", "tests/".' },
          maxResults: { type: 'number', description: 'Maximum files to return. Default 200.' },
          includeHidden: { type: 'boolean', description: 'Include hidden dotfiles. Default false.' },
        },
      },
      handler: (args) => listFiles(args, config, adapter),
    },
    {
      name: 'read_file',
      description:
        'Read the content of a file in the workspace. Path-safe, blocks sensitive/binary files, supports bounded line ranges.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to workspace root.' },
          startLine: { type: 'number', description: '1-based start line (inclusive).' },
          endLine: { type: 'number', description: '1-based end line (inclusive).' },
          maxLines: { type: 'number', description: 'Maximum lines to return. Default 500.' },
        },
        required: ['path'],
      },
      handler: (args) => readFile(args, config, adapter),
    },
    {
      name: 'text_search',
      description:
        'Search for text or regex patterns across workspace files with context lines and line numbers. Respects ignore rules.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query string or regex pattern.' },
          filePattern: { type: 'string', description: 'Optional file glob/extension filter.' },
          caseSensitive: { type: 'boolean', description: 'Case-sensitive search.' },
          isRegex: { type: 'boolean', description: 'Whether query is a regex.' },
          maxResults: { type: 'number', description: 'Maximum matches to return. Default 50.' },
          contextLines: { type: 'number', description: 'Context lines before and after match.' },
        },
        required: ['query'],
      },
      handler: (args) => textSearch(args, config, adapter),
    },
    {
      name: 'discover_symbols',
      description:
        'Discover code symbols (functions, classes, methods, imports, decorators, and call sites) with exact line ranges using Python AST.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to the file in the workspace.' },
        },
        required: ['path'],
      },
      handler: (args) => discoverSymbols(args, config, adapter),
    },
    {
      name: 'resolve_references',
      description:
        'Resolve explicit @file:path and @symbol:name developer references. Verifies path safety, locates exact AST symbol definitions, detects ambiguities, and retrieves code snippets.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'User query or text containing @file:path or @symbol:name tags.' },
        },
        required: ['query'],
      },
      handler: (args) => resolveExplicitReferences(args.query, config, adapter),
    },
    {
      name: 'retrieve_context',
      description:
        'Automatically retrieve relevant code context for a task. Combines keyword extraction, path relevance, text search, symbol definitions, and test file discovery with strict budget enforcement and an Evidence Trail.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'User instruction or problem description.' },
          budgetChars: { type: 'number', description: 'Maximum character budget. Defaults to 100,000.' },
          maxFiles: { type: 'number', description: 'Maximum number of distinct files. Defaults to 5.' },
        },
        required: ['prompt'],
      },
      handler: (args) => retrieveContext(args, config, adapter),
    },
  ];
}
