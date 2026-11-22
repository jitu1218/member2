/**
 * ProofPatch MCP Server — Main Entry Point
 *
 * Starts the MCP server using the workspace root from CLI args or env.
 */

import path from 'node:path';
import { startServer } from './server.js';

const workspaceRoot =
  process.argv[2] || process.env.PROOFPATCH_WORKSPACE_ROOT || process.cwd();

console.error(
  `[proofpatch-mcp] Starting with workspace root: ${path.resolve(workspaceRoot)}`
);

startServer({ workspaceRoot: path.resolve(workspaceRoot) }).catch((err) => {
  console.error('[proofpatch-mcp] Fatal error:', err);
  process.exit(1);
});
