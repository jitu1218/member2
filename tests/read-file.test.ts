/**
 * Tests for the read-file tool.
 * Covers path safety, size limits, line ranges, sensitive files, and binary detection.
 */

import path from 'node:path';
import type { ServerConfig, WorkspaceViewAdapter } from '../src/types/index.js';
import { DEFAULT_CONFIG } from '../src/types/index.js';
import { readFile } from '../src/tools/read-file.js';

const ROOT = process.platform === 'win32' ? 'C:\\testworkspace' : '/testworkspace';
const sep = process.platform === 'win32' ? '\\' : '/';
function fp(...parts: string[]) { return [ROOT, ...parts].join(sep); }

const config: ServerConfig = {
  ...DEFAULT_CONFIG,
  workspaceRoot: ROOT,
  maxFileSizeBytes: 10_000,
  maxReadLines: 10,
};

function createMockAdapter(files: Record<string, { content: string; size: number }>): WorkspaceViewAdapter {
  return {
    async readFile(p: string) {
      const f = files[p];
      if (!f) throw new Error(`ENOENT: ${p}`);
      return f.content;
    },
    async fileExists(p: string) {
      return p in files;
    },
    async fileStat(p: string) {
      const f = files[p];
      if (!f) return null;
      return { size: f.size, isFile: true, isDirectory: false };
    },
    async readDirectory() { return []; },
  };
}

describe('readFile', () => {
  it('reads a file within workspace', async () => {
    const content = 'line1\nline2\nline3';
    const adapter = createMockAdapter({
      [fp('src', 'app.py')]: { content, size: content.length },
    });

    const result = await readFile({ path: 'src/app.py' }, config, adapter);
    expect(result).not.toHaveProperty('error');
    if (!('error' in result)) {
      expect(result.content).toBe(content);
      expect(result.totalLines).toBe(3);
      expect(result.startLine).toBe(1);
      expect(result.endLine).toBe(3);
      expect(result.truncated).toBe(false);
    }
  });

  it('supports line range reads', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    const content = lines.join('\n');
    const adapter = createMockAdapter({
      [fp('big.py')]: { content, size: content.length },
    });

    const result = await readFile({ path: 'big.py', startLine: 5, endLine: 8 }, config, adapter);
    expect(result).not.toHaveProperty('error');
    if (!('error' in result)) {
      expect(result.startLine).toBe(5);
      expect(result.endLine).toBe(8);
      expect(result.content).toBe('line 5\nline 6\nline 7\nline 8');
      expect(result.totalLines).toBe(20);
    }
  });

  it('truncates when exceeding maxLines', async () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
    const content = lines.join('\n');
    const adapter = createMockAdapter({
      [fp('long.py')]: { content, size: content.length },
    });

    const result = await readFile({ path: 'long.py' }, config, adapter);
    expect(result).not.toHaveProperty('error');
    if (!('error' in result)) {
      expect(result.truncated).toBe(true);
      expect(result.endLine).toBe(10); // maxReadLines is 10
      expect(result.truncationMessage).toBeDefined();
      expect(result.truncationMessage).toContain('truncated');
    }
  });

  it('rejects path traversal with ..', async () => {
    const adapter = createMockAdapter({});
    const result = await readFile({ path: '../../etc/passwd' }, config, adapter);
    expect(result).toHaveProperty('error');
    if ('error' in result) {
      expect(result.error.code).toBe('PATH_TRAVERSAL_ATTEMPT');
    }
  });

  it('rejects empty path', async () => {
    const adapter = createMockAdapter({});
    const result = await readFile({ path: '' }, config, adapter);
    expect(result).toHaveProperty('error');
    if ('error' in result) {
      expect(result.error.code).toBe('INVALID_INPUT');
    }
  });

  it('rejects sensitive files', async () => {
    const adapter = createMockAdapter({
      [fp('.env')]: { content: 'SECRET=abc', size: 10 },
    });
    const result = await readFile({ path: '.env' }, config, adapter);
    expect(result).toHaveProperty('error');
    if ('error' in result) {
      expect(result.error.code).toBe('SENSITIVE_FILE');
    }
  });

  it('rejects .env.production', async () => {
    const adapter = createMockAdapter({
      [fp('.env.production')]: { content: 'DB=x', size: 4 },
    });
    const result = await readFile({ path: '.env.production' }, config, adapter);
    expect(result).toHaveProperty('error');
    if ('error' in result) {
      expect(result.error.code).toBe('SENSITIVE_FILE');
    }
  });

  it('rejects binary files', async () => {
    const adapter = createMockAdapter({
      [fp('image.png')]: { content: '', size: 5000 },
    });
    const result = await readFile({ path: 'image.png' }, config, adapter);
    expect(result).toHaveProperty('error');
    if ('error' in result) {
      expect(result.error.code).toBe('BINARY_FILE');
    }
  });

  it('rejects files exceeding size limit', async () => {
    const adapter = createMockAdapter({
      [fp('huge.py')]: { content: 'x', size: 999_999 },
    });

    const result = await readFile({ path: 'huge.py' }, { ...config, maxFileSizeBytes: 500 }, adapter);
    expect(result).toHaveProperty('error');
    if ('error' in result) {
      expect(result.error.code).toBe('FILE_TOO_LARGE');
    }
  });

  it('reports file not found', async () => {
    const adapter = createMockAdapter({});
    const result = await readFile({ path: 'nonexistent.py' }, config, adapter);
    expect(result).toHaveProperty('error');
    if ('error' in result) {
      expect(result.error.code).toBe('FILE_NOT_FOUND');
    }
  });

  it('clamps startLine and endLine to valid range', async () => {
    const content = 'a\nb\nc';
    const adapter = createMockAdapter({
      [fp('small.py')]: { content, size: content.length },
    });

    const result = await readFile({ path: 'small.py', startLine: 0, endLine: 100 }, config, adapter);
    expect(result).not.toHaveProperty('error');
    if (!('error' in result)) {
      expect(result.startLine).toBe(1);
      expect(result.endLine).toBe(3);
      expect(result.content).toBe('a\nb\nc');
    }
  });

  it('rejects private key files', async () => {
    const adapter = createMockAdapter({
      [fp('id_rsa')]: { content: 'key', size: 3 },
    });
    const result = await readFile({ path: 'id_rsa' }, config, adapter);
    expect(result).toHaveProperty('error');
    if ('error' in result) {
      expect(result.error.code).toBe('SENSITIVE_FILE');
    }
  });
});
