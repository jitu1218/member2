/**
 * ProofPatch MCP Server — Filesystem Adapter
 *
 * Default implementation of WorkspaceViewAdapter that reads directly
 * from the real filesystem. This will be replaced by Member 4's
 * WorkspaceView overlay when available.
 *
 * PROVISIONAL: See types/index.ts WorkspaceViewAdapter.
 */

import fs from 'node:fs/promises';
import type { WorkspaceViewAdapter } from '../types/index.js';

/**
 * Direct filesystem adapter — reads the real workspace on disk.
 */
export class FilesystemAdapter implements WorkspaceViewAdapter {
  async readFile(absolutePath: string): Promise<string> {
    return fs.readFile(absolutePath, 'utf-8');
  }

  async fileExists(absolutePath: string): Promise<boolean> {
    try {
      await fs.access(absolutePath);
      return true;
    } catch {
      return false;
    }
  }

  async fileStat(absolutePath: string): Promise<{
    size: number;
    isFile: boolean;
    isDirectory: boolean;
  } | null> {
    try {
      const stat = await fs.stat(absolutePath);
      return {
        size: stat.size,
        isFile: stat.isFile(),
        isDirectory: stat.isDirectory(),
      };
    } catch {
      return null;
    }
  }

  async readDirectory(absolutePath: string): Promise<string[]> {
    return fs.readdir(absolutePath);
  }
}
