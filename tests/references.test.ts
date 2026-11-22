/**
 * Unit tests for explicit @file and @symbol reference resolution.
 */

import {
  extractExplicitReferences,
  resolveExplicitReferences,
} from '../src/context/references.js';
import { DEFAULT_CONFIG, type WorkspaceViewAdapter } from '../src/types/index.js';

describe('extractExplicitReferences', () => {
  it('extracts @file and @symbol correctly from natural user queries', () => {
    const input =
      'Please check @file:src/flask/helpers.py and update @symbol:get_debug_flag to support off and n. Also see @file:"docs/conf.py".';
    const refs = extractExplicitReferences(input);

    expect(refs).toHaveLength(3);
    expect(refs[0]).toEqual({
      raw: '@file:src/flask/helpers.py',
      kind: 'file',
      target: 'src/flask/helpers.py',
    });
    expect(refs[1]).toEqual({
      raw: '@symbol:get_debug_flag',
      kind: 'symbol',
      target: 'get_debug_flag',
    });
    expect(refs[2]).toEqual({
      raw: '@file:"docs/conf.py"',
      kind: 'file',
      target: 'docs/conf.py',
    });
  });

  it('deduplicates identical references in the prompt', () => {
    const input = '@file:src/app.py and again @file:src/app.py';
    const refs = extractExplicitReferences(input);
    expect(refs).toHaveLength(1);
  });

  it('returns empty array when no references exist', () => {
    const input = 'Add a CLI command to print json config';
    const refs = extractExplicitReferences(input);
    expect(refs).toEqual([]);
  });
});

describe('resolveExplicitReferences', () => {
  const ROOT = process.platform === 'win32' ? 'C:\\workspace' : '/workspace';
  const sep = process.platform === 'win32' ? '\\' : '/';
  function fp(...parts: string[]) {
    return [ROOT, ...parts].join(sep);
  }

  const helpersPy = `
def get_debug_flag():
    return True

def common_func():
    return 1
`;

  const otherPy = `
def common_func():
    return 2
`;

  const tree: Record<string, any> = {
    [ROOT]: { isDirectory: true, children: ['src'] },
    [fp('src')]: { isDirectory: true, children: ['helpers.py', 'other.py'] },
    [fp('src', 'helpers.py')]: {
      isFile: true,
      content: helpersPy,
      size: helpersPy.length,
    },
    [fp('src', 'other.py')]: {
      isFile: true,
      content: otherPy,
      size: otherPy.length,
    },
  };

  const mockAdapter: WorkspaceViewAdapter = {
    async readFile(p: string) {
      const f = tree[p];
      if (!f || !f.isFile) throw new Error(`ENOENT: ${p}`);
      return f.content ?? '';
    },
    async fileExists(p: string) {
      return p in tree;
    },
    async fileStat(p: string) {
      const f = tree[p];
      if (!f) return null;
      return {
        size: f.size ?? 0,
        isFile: f.isFile ?? false,
        isDirectory: f.isDirectory ?? false,
      };
    },
    async readDirectory(p: string) {
      const f = tree[p];
      if (!f?.isDirectory || !f.children) return [];
      return f.children;
    },
  };

  const config = { ...DEFAULT_CONFIG, workspaceRoot: ROOT };

  it('resolves valid @file reference with content', async () => {
    const res = await resolveExplicitReferences(
      '@file:src/helpers.py',
      config,
      mockAdapter,
    );
    expect(res.totalResolved).toBe(1);
    expect(res.references[0].status).toBe('resolved');
    if (res.references[0].kind === 'file') {
      expect(res.references[0].content).toContain('get_debug_flag');
    }
  });

  it('handles missing @file reference accurately without inventing', async () => {
    const res = await resolveExplicitReferences(
      '@file:src/missing.py',
      config,
      mockAdapter,
    );
    expect(res.totalNotFound).toBe(1);
    expect(res.references[0].status).toBe('not_found');
    if (res.references[0].kind === 'file') {
      expect(res.references[0].error).toMatch(/not found/i);
    }
  });

  it('resolves unique @symbol reference with snippet', async () => {
    const res = await resolveExplicitReferences(
      '@symbol:get_debug_flag',
      config,
      mockAdapter,
    );
    expect(res.totalResolved).toBe(1);
    const ref = res.references[0];
    expect(ref.status).toBe('resolved');
    if (ref.kind === 'symbol') {
      expect(ref.selectedMatch?.name).toBe('get_debug_flag');
      expect(ref.snippet).toContain('return True');
    }
  });

  it('detects ambiguous @symbol reference defined in multiple locations', async () => {
    const res = await resolveExplicitReferences(
      '@symbol:common_func',
      config,
      mockAdapter,
    );
    expect(res.totalAmbiguous).toBe(1);
    const ref = res.references[0];
    expect(ref.status).toBe('ambiguous');
    if (ref.kind === 'symbol') {
      expect(ref.matches.length).toBe(2);
      expect(ref.error).toContain('ambiguous');
    }
  });

  it('marks non-existent @symbol reference as not_found', async () => {
    const res = await resolveExplicitReferences(
      '@symbol:ghost_function',
      config,
      mockAdapter,
    );
    expect(res.totalNotFound).toBe(1);
    const ref = res.references[0];
    expect(ref.status).toBe('not_found');
  });
});
