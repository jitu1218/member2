/**
 * ProofPatch MCP Server — Staged Overlay Adapter (Provisional for Member 4)
 *
 * PROVISIONAL: This adapter implements `WorkspaceViewAdapter` and allows Member 4's
 * Safe Patch Engine to supply an in-memory overlay map representing staged/accepted hunks.
 *
 * All MCP tools (list, read, search, symbols, retrieveContext) transparently query
 * this overlay before falling back to disk.
 *
 * When Member 4 provides the official WorkspaceView interface, this file will bridge it.
 */
import type { WorkspaceViewAdapter } from '../types/index.js';
export interface StagedOverlayState {
    /** Map of normalized absolute path -> staged file content */
    stagedFiles: Map<string, string>;
    /** Set of deleted file paths in the overlay */
    deletedFiles?: Set<string>;
}
export declare class StagedWorkspaceViewAdapter implements WorkspaceViewAdapter {
    private fallbackFs;
    private overlay;
    constructor(overlay?: StagedOverlayState);
    /**
     * Update or set the staged overlay state.
     */
    setOverlay(overlay: StagedOverlayState): void;
    /**
     * Whether the overlay has active staged changes or deletions.
     */
    hasStagedChanges(): boolean;
    readFile(absolutePath: string): Promise<string>;
    fileExists(absolutePath: string): Promise<boolean>;
    fileStat(absolutePath: string): Promise<{
        size: number;
        isFile: boolean;
        isDirectory: boolean;
    } | null>;
    readDirectory(absolutePath: string): Promise<string[]>;
}
//# sourceMappingURL=overlay-adapter.d.ts.map