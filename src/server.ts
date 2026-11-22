/**
 * ProofPatch MCP Server — Server Entry Point
 *
 * Registers MCP tools for workspace inspection and code understanding.
 * Uses the MCP SDK's McpServer class and stdio transport.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { ServerConfig, WorkspaceViewAdapter } from './types/index.js';
import { DEFAULT_CONFIG } from './types/index.js';
import { FilesystemAdapter } from './tools/fs-adapter.js';
import { listFiles } from './tools/list-files.js';
import { readFile } from './tools/read-file.js';
import { textSearch } from './search/text-search.js';
import { discoverSymbols } from './symbols/discovery.js';
import { resolveExplicitReferences } from './context/references.js';
import { retrieveContext } from './context/retriever.js';

/**
 * Create and configure the ProofPatch MCP server.
 */
export function createServer(
  configOverrides?: Partial<ServerConfig>,
  customAdapter?: WorkspaceViewAdapter,
) {
  const config: ServerConfig = { ...DEFAULT_CONFIG, ...configOverrides };
  const adapter = customAdapter || new FilesystemAdapter();

  const server = new McpServer({
    name: 'proofpatch-workspace',
    version: '0.1.0',
  });

  // ─── list_files ────────────────────────────────────────────────

  server.tool(
    'list_files',
    'List files in the workspace directory. Respects .gitignore-style exclusion rules, skips node_modules, build outputs, and hidden files by default. Returns relative paths, extensions, and file sizes.',
    {
      directory: z
        .string()
        .optional()
        .describe('Subdirectory to list (relative to workspace root). Omit to list from root.'),
      pattern: z
        .string()
        .optional()
        .describe('File pattern filter, e.g. "*.py", "tests/", "**/*.ts".'),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .optional()
        .describe('Maximum files to return. Default 200, max 1000.'),
      includeHidden: z
        .boolean()
        .optional()
        .describe('Include hidden files (dotfiles). Default false.'),
    },
    async (args) => {
      if (!config.workspaceRoot) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: {
                  code: 'INVALID_INPUT',
                  message: 'Workspace root is not configured.',
                },
              }),
            },
          ],
          isError: true,
        };
      }

      const result = await listFiles(args, config, adapter);

      if ('error' in result) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // ─── read_file ─────────────────────────────────────────────────

  server.tool(
    'read_file',
    'Read the content of a file in the workspace. Accepts relative paths only. Prevents reading outside the workspace, blocks binary and sensitive files. Supports line-range reads. Always indicates when content is truncated.',
    {
      path: z
        .string()
        .describe('File path relative to the workspace root.'),
      startLine: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe('Start line (1-based, inclusive). Omit to read from the beginning.'),
      endLine: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe('End line (1-based, inclusive). Omit to read to the end.'),
      maxLines: z
        .number()
        .int()
        .min(1)
        .max(5000)
        .optional()
        .describe('Maximum lines to return. Default 500. Truncated content is flagged.'),
    },
    async (args) => {
      if (!config.workspaceRoot) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: {
                  code: 'INVALID_INPUT',
                  message: 'Workspace root is not configured.',
                },
              }),
            },
          ],
          isError: true,
        };
      }

      const result = await readFile(args, config, adapter);

      if ('error' in result) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // ─── text_search ───────────────────────────────────────────────

  server.tool(
    'text_search',
    'Search for text or regex patterns across files in the workspace. Returns matching lines with line numbers, context lines, and file paths. Respects ignore rules, skips binary and sensitive files.',
    {
      query: z
        .string()
        .describe('Search query string or regex pattern.'),
      filePattern: z
        .string()
        .optional()
        .describe('Optional file glob/extension filter, e.g. "*.py", "tests/".'),
      caseSensitive: z
        .boolean()
        .optional()
        .describe('Case-sensitive search. Default false.'),
      isRegex: z
        .boolean()
        .optional()
        .describe('Whether query is a regular expression. Default false.'),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe('Maximum number of matches to return. Default 50.'),
      contextLines: z
        .number()
        .int()
        .min(0)
        .max(5)
        .optional()
        .describe('Number of lines of context before and after each match. Default 2, max 5.'),
    },
    async (args) => {
      if (!config.workspaceRoot) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: {
                  code: 'INVALID_INPUT',
                  message: 'Workspace root is not configured.',
                },
              }),
            },
          ],
          isError: true,
        };
      }

      const result = await textSearch(args, config, adapter);

      if ('error' in result) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // ─── discover_symbols ──────────────────────────────────────────

  server.tool(
    'discover_symbols',
    'Discover code symbols (functions, classes, methods, imports, decorators, and call sites) with exact line ranges. Uses Python AST for high accuracy on Python repositories.',
    {
      path: z
        .string()
        .describe('Relative path to the file in the workspace.'),
    },
    async (args) => {
      if (!config.workspaceRoot) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: {
                  code: 'INVALID_INPUT',
                  message: 'Workspace root is not configured.',
                },
              }),
            },
          ],
          isError: true,
        };
      }

      const result = await discoverSymbols(args, config, adapter);

      if ('error' in result) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // ─── resolve_references ────────────────────────────────────────

  server.tool(
    'resolve_references',
    'Resolve explicit @file:path and @symbol:name developer references. Verifies path safety, locates exact AST symbol definitions, detects ambiguities, and retrieves code snippets.',
    {
      query: z
        .string()
        .describe('User query or text containing @file:path or @symbol:name tags.'),
    },
    async (args) => {
      if (!config.workspaceRoot) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: {
                  code: 'INVALID_INPUT',
                  message: 'Workspace root is not configured.',
                },
              }),
            },
          ],
          isError: true,
        };
      }

      const result = await resolveExplicitReferences(args.query, config, adapter);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // ─── retrieve_context ──────────────────────────────────────────

  server.tool(
    'retrieve_context',
    'Automatically retrieve relevant code context for a task. Combines keyword extraction, path relevance, text search, symbol definitions, and test file discovery. Enforces a strict context budget and produces an evidence trail explaining why code was selected or omitted.',
    {
      prompt: z
        .string()
        .describe('User instruction or problem description.'),
      budgetChars: z
        .number()
        .int()
        .min(100)
        .max(1_000_000)
        .optional()
        .describe('Maximum character budget for the returned context. Defaults to 100,000.'),
      maxFiles: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe('Maximum number of distinct files to retrieve. Defaults to 5.'),
    },
    async (args) => {
      if (!config.workspaceRoot) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: {
                  code: 'INVALID_INPUT',
                  message: 'Workspace root is not configured.',
                },
              }),
            },
          ],
          isError: true,
        };
      }

      const result = await retrieveContext(args, config, adapter);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  return { server, config, adapter };
}

/**
 * Start the MCP server with stdio transport.
 */
export async function startServer(
  configOverrides?: Partial<ServerConfig>,
  customAdapter?: WorkspaceViewAdapter,
) {
  const { server } = createServer(configOverrides, customAdapter);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
