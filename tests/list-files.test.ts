/**
 * Tests for the list-files tool.
 * Uses a mock WorkspaceViewAdapter to avoid filesystem dependencies.
 */

import type { ServerConfig, WorkspaceViewAdapter } from '../src/types/index.js';
import { DEFAULT_CONFIG } from '../src/types/index.js';
import { listFiles } from '../src/tools/list-files.js';

/** Create a mock adapter from a virtual file tree */
function createMockAdapter(
  fileTree: Record<string, { isFile: boolean; isDirectory: boolean; size: number; children?: string[] }>,
): WorkspaceViewAdapter {
  return {
    async readFile(p: string) {
      if (fileTree[p]?.isFile) return 'mock content';
      throw new Error(`ENOENT: ${p}`);
    },
    async fileExists(p: string) {
      return p in fileTree;
    },
    async fileStat(p: string) {
      const entry = fileTree[p];
      if (!entry) return null;
      return { size: entry.size, isFile: entry.isFile, isDirectory: entry.isDirectory };
    },
    async readDirectory(p: string) {
      const entry = fileTree[p];
      if (!entry?.isDirectory || !entry.children) return [];
      return entry.children;
    },
  };
}

const ROOT = process.platform === 'win32' ? 'C:\\testworkspace' : '/testworkspace';
const sep = process.platform === 'win32' ? '\\' : '/';

function p(...parts: string[]) {
  return [ROOT, ...parts].join(sep);
}

const config: ServerConfig = {
  ...DEFAULT_CONFIG,
  workspaceRoot: ROOT,
};

describe('listFiles', () => {
  it('lists files from the workspace root', async () => {
    const tree: Record<string, any> = {
      [ROOT]: { isFile: false, isDirectory: true, size: 0, children: ['src', 'README.md'] },
      [p('src')]: { isFile: false, isDirectory: true, size: 0, children: ['main.py', 'util.py'] },
      [p('src', 'main.py')]: { isFile: true, isDirectory: false, size: 1024 },
      [p('src', 'util.py')]: { isFile: true, isDirectory: false, size: 512 },
      [p('README.md')]: { isFile: true, isDirectory: false, size: 256 },
    };
    const adapter = createMockAdapter(tree);

    const result = await listFiles({}, config, adapter);
    expect(result).not.toHaveProperty('error');
    if (!('error' in result)) {
      expect(result.files.length).toBe(3);
      const paths = result.files.map((f) => f.relativePath);
      expect(paths).toContain('README.md');
      expect(paths).toContain('src/main.py');
      expect(paths).toContain('src/util.py');
    }
  });

  it('excludes node_modules', async () => {
    const tree: Record<string, any> = {
      [ROOT]: { isFile: false, isDirectory: true, size: 0, children: ['src', 'node_modules'] },
      [p('src')]: { isFile: false, isDirectory: true, size: 0, children: ['app.ts'] },
      [p('src', 'app.ts')]: { isFile: true, isDirectory: false, size: 200 },
      [p('node_modules')]: { isFile: false, isDirectory: true, size: 0, children: ['express'] },
      [p('node_modules', 'express')]: { isFile: false, isDirectory: true, size: 0, children: ['index.js'] },
      [p('node_modules', 'express', 'index.js')]: { isFile: true, isDirectory: false, size: 5000 },
    };
    const adapter = createMockAdapter(tree);

    const result = await listFiles({}, config, adapter);
    expect(result).not.toHaveProperty('error');
    if (!('error' in result)) {
      expect(result.files.length).toBe(1);
      expect(result.files[0].relativePath).toBe('src/app.ts');
      expect(result.excludedCount).toBeGreaterThan(0);
    }
  });

  it('respects workspace .gitignore rules', async () => {
    const tree: Record<string, any> = {
      [ROOT]: { isFile: false, isDirectory: true, size: 0, children: ['src', '.gitignore'] },
      [p('.gitignore')]: { isFile: true, isDirectory: false, size: 20, content: 'custom_ignore.py\n' },
      [p('src')]: { isFile: false, isDirectory: true, size: 0, children: ['app.py', 'custom_ignore.py'] },
      [p('src', 'app.py')]: { isFile: true, isDirectory: false, size: 100 },
      [p('src', 'custom_ignore.py')]: { isFile: true, isDirectory: false, size: 100 },
    };
    const adapter = {
      ...createMockAdapter(tree),
      async readFile(p: string) {
        if (p.endsWith('.gitignore')) return 'custom_ignore.py\n';
        return 'mock';
      },
    };

    const result = await listFiles({}, config, adapter);
    expect(result).not.toHaveProperty('error');
    if (!('error' in result)) {
      const paths = result.files.map((f) => f.relativePath);
      expect(paths).toContain('src/app.py');
      expect(paths).not.toContain('src/custom_ignore.py');
      expect(result.excludedCount).toBeGreaterThan(0);
    }
  });

  it('excludes hidden files by default', async () => {
    const tree: Record<string, any> = {
      [ROOT]: { isFile: false, isDirectory: true, size: 0, children: ['visible.py', '.hidden'] },
      [p('visible.py')]: { isFile: true, isDirectory: false, size: 100 },
      [p('.hidden')]: { isFile: true, isDirectory: false, size: 50 },
    };
    const adapter = createMockAdapter(tree);

    const result = await listFiles({}, config, adapter);
    expect(result).not.toHaveProperty('error');
    if (!('error' in result)) {
      expect(result.files.length).toBe(1);
      expect(result.files[0].relativePath).toBe('visible.py');
    }
  });

  it('includes hidden files when requested', async () => {
    const tree: Record<string, any> = {
      [ROOT]: { isFile: false, isDirectory: true, size: 0, children: ['visible.py', '.hidden'] },
      [p('visible.py')]: { isFile: true, isDirectory: false, size: 100 },
      [p('.hidden')]: { isFile: true, isDirectory: false, size: 50 },
    };
    const adapter = createMockAdapter(tree);

    const result = await listFiles({ includeHidden: true }, config, adapter);
    expect(result).not.toHaveProperty('error');
    if (!('error' in result)) {
      expect(result.files.length).toBe(2);
    }
  });

  it('filters by pattern', async () => {
    const tree: Record<string, any> = {
      [ROOT]: { isFile: false, isDirectory: true, size: 0, children: ['app.py', 'README.md', 'tests'] },
      [p('app.py')]: { isFile: true, isDirectory: false, size: 500 },
      [p('README.md')]: { isFile: true, isDirectory: false, size: 200 },
      [p('tests')]: { isFile: false, isDirectory: true, size: 0, children: ['test_app.py'] },
      [p('tests', 'test_app.py')]: { isFile: true, isDirectory: false, size: 300 },
    };
    const adapter = createMockAdapter(tree);

    const result = await listFiles({ pattern: '*.py' }, config, adapter);
    expect(result).not.toHaveProperty('error');
    if (!('error' in result)) {
      expect(result.files.length).toBe(2);
      expect(result.files.every((f) => f.relativePath.endsWith('.py'))).toBe(true);
    }
  });

  it('respects maxResults', async () => {
    const children = Array.from({ length: 10 }, (_, i) => `file${i}.py`);
    const tree: Record<string, any> = {
      [ROOT]: { isFile: false, isDirectory: true, size: 0, children },
    };
    for (const child of children) {
      tree[p(child)] = { isFile: true, isDirectory: false, size: 100 };
    }
    const adapter = createMockAdapter(tree);

    const result = await listFiles({ maxResults: 3 }, config, adapter);
    expect(result).not.toHaveProperty('error');
    if (!('error' in result)) {
      expect(result.files.length).toBe(3);
      expect(result.truncated).toBe(true);
    }
  });

  it('returns error for nonexistent directory', async () => {
    const tree: Record<string, any> = {
      [ROOT]: { isFile: false, isDirectory: true, size: 0, children: [] },
    };
    const adapter = createMockAdapter(tree);

    const result = await listFiles({ directory: 'nonexistent' }, config, adapter);
    expect(result).toHaveProperty('error');
    if ('error' in result) {
      expect(result.error.code).toBe('FILE_NOT_FOUND');
    }
  });

  it('returns error for workspace-escaping directory', async () => {
    const tree: Record<string, any> = {
      [ROOT]: { isFile: false, isDirectory: true, size: 0, children: [] },
    };
    const adapter = createMockAdapter(tree);

    const result = await listFiles({ directory: '../../etc' }, config, adapter);
    expect(result).toHaveProperty('error');
    if ('error' in result) {
      expect(result.error.code).toBe('PATH_OUTSIDE_WORKSPACE');
    }
  });
});
