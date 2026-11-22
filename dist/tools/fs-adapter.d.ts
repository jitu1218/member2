/**
 * ProofPatch MCP Server — Filesystem Adapter
 *
 * Default implementation of WorkspaceViewAdapter that reads directly
 * from the real filesystem. This will be replaced by Member 4's
 * WorkspaceView overlay when available.
 *
 * PROVISIONAL: See types/index.ts WorkspaceViewAdapter.
 */
import type { WorkspaceViewAdapter } from '../types/index.js';
/**
 * Direct filesystem adapter — reads the real workspace on disk.
 */
export declare class FilesystemAdapter implements WorkspaceViewAdapter {
    readFile(absolutePath: string): Promise<string>;
    fileExists(absolutePath: string): Promise<boolean>;
    fileStat(absolutePath: string): Promise<{
        size: number;
        isFile: boolean;
        isDirectory: boolean;
    } | null>;
    readDirectory(absolutePath: string): Promise<string[]>;
}
//# sourceMappingURL=fs-adapter.d.ts.map