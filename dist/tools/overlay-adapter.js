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
import path from 'node:path';
import { FilesystemAdapter } from './fs-adapter.js';
export class StagedWorkspaceViewAdapter {
    fallbackFs;
    overlay;
    constructor(overlay) {
        this.fallbackFs = new FilesystemAdapter();
        this.overlay = overlay || {
            stagedFiles: new Map(),
            deletedFiles: new Set(),
        };
    }
    /**
     * Update or set the staged overlay state.
     */
    setOverlay(overlay) {
        this.overlay = overlay;
    }
    /**
     * Whether the overlay has active staged changes or deletions.
     */
    hasStagedChanges() {
        return (this.overlay.stagedFiles.size > 0 ||
            (this.overlay.deletedFiles !== undefined && this.overlay.deletedFiles.size > 0));
    }
    async readFile(absolutePath) {
        const norm = path.resolve(absolutePath);
        if (this.overlay.deletedFiles?.has(norm)) {
            throw new Error(`ENOENT: File marked deleted in staged overlay: ${norm}`);
        }
        if (this.overlay.stagedFiles.has(norm)) {
            return this.overlay.stagedFiles.get(norm);
        }
        return this.fallbackFs.readFile(norm);
    }
    async fileExists(absolutePath) {
        const norm = path.resolve(absolutePath);
        if (this.overlay.deletedFiles?.has(norm)) {
            return false;
        }
        if (this.overlay.stagedFiles.has(norm)) {
            return true;
        }
        return this.fallbackFs.fileExists(norm);
    }
    async fileStat(absolutePath) {
        const norm = path.resolve(absolutePath);
        if (this.overlay.deletedFiles?.has(norm)) {
            return null;
        }
        if (this.overlay.stagedFiles.has(norm)) {
            const content = this.overlay.stagedFiles.get(norm);
            return {
                size: Buffer.byteLength(content, 'utf-8'),
                isFile: true,
                isDirectory: false,
            };
        }
        return this.fallbackFs.fileStat(norm);
    }
    async readDirectory(absolutePath) {
        const norm = path.resolve(absolutePath);
        const diskEntries = (await this.fallbackFs.readDirectory(norm)).filter((entry) => !this.overlay.deletedFiles?.has(path.resolve(norm, entry)));
        // Merge in any newly created files in the overlay under this directory
        const overlayEntries = new Set(diskEntries);
        for (const stagedPath of this.overlay.stagedFiles.keys()) {
            if (path.dirname(stagedPath) === norm) {
                overlayEntries.add(path.basename(stagedPath));
            }
        }
        return Array.from(overlayEntries);
    }
}
//# sourceMappingURL=overlay-adapter.js.map