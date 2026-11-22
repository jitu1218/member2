/**
 * Integration tests for Phase 6:
 * - TrueForge tool registration and in-process execution.
 * - Staged WorkspaceView overlay adapter (Member 4 integration point).
 * - Verifying that tools read staged content transparently over disk content.
 */

import path from 'node:path';
import { getTrueForgeTools } from '../src/trueforge.js';
import { StagedWorkspaceViewAdapter } from '../src/tools/overlay-adapter.js';

describe('TrueForge integration harness', () => {
  it('exposes all 6 mandatory tools with valid schemas and handlers', () => {
    const tools = getTrueForgeTools({ workspaceRoot: '/test' });
    const names = tools.map((t) => t.name);

    expect(names).toEqual([
      'list_files',
      'read_file',
      'text_search',
      'discover_symbols',
      'resolve_references',
      'retrieve_context',
    ]);

    for (const tool of tools) {
      expect(typeof tool.name).toBe('string');
      expect(typeof tool.description).toBe('string');
      expect(tool.parameters).toBeDefined();
      expect(typeof tool.handler).toBe('function');
    }
  });
});

describe('Member 4 Staged WorkspaceView Overlay Adapter', () => {
  const ROOT = process.platform === 'win32' ? 'C:\\overlay_test' : '/overlay_test';
  const filePath = path.resolve(ROOT, 'src', 'helpers.py');

  it('reads staged overlay content instead of on-disk content', async () => {
    const stagedContent = 'def get_debug_flag():\n    return "staged_value"\n';

    const stagedAdapter = new StagedWorkspaceViewAdapter({
      stagedFiles: new Map([[filePath, stagedContent]]),
      deletedFiles: new Set(),
    });

    const exists = await stagedAdapter.fileExists(filePath);
    expect(exists).toBe(true);

    const stat = await stagedAdapter.fileStat(filePath);
    expect(stat?.isFile).toBe(true);
    expect(stat?.size).toBe(Buffer.byteLength(stagedContent, 'utf-8'));

    const content = await stagedAdapter.readFile(filePath);
    expect(content).toBe(stagedContent);
  });

  it('returns deleted file status when file is marked deleted in staged overlay', async () => {
    const deletedFile = path.resolve(ROOT, 'src', 'obsolete.py');

    const stagedAdapter = new StagedWorkspaceViewAdapter({
      stagedFiles: new Map(),
      deletedFiles: new Set([deletedFile]),
    });

    const exists = await stagedAdapter.fileExists(deletedFile);
    expect(exists).toBe(false);

    const stat = await stagedAdapter.fileStat(deletedFile);
    expect(stat).toBeNull();

    await expect(stagedAdapter.readFile(deletedFile)).rejects.toThrow(/deleted/i);
  });

  it('allows tools to execute on staged content seamlessly', async () => {
    const tools = getTrueForgeTools(
      { workspaceRoot: ROOT },
      new StagedWorkspaceViewAdapter({
        stagedFiles: new Map([[filePath, 'def get_debug_flag(): return "staged"']]),
      }),
    );

    const readFileTool = tools.find((t) => t.name === 'read_file')!;
    const res = await readFileTool.handler({ path: 'src/helpers.py' });

    expect(res).not.toHaveProperty('error');
    expect(res.content).toBe('def get_debug_flag(): return "staged"');
  });
});
