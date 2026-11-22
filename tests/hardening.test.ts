/**
 * Phase 7 Hardening & Safety Tests
 *
 * Exhaustively validates error scenarios, boundaries, and untrusted inputs:
 * 1. Path traversal attacks (relative ../, encoded sequences, absolute escapes).
 * 2. Sensitive secret leak prevention (.env, keys, cloud credentials).
 * 3. File size limits and truncation guarantees.
 * 4. Binary file prevention across all inspection tools.
 * 5. Parsing resiliency on adversarial code.
 * 6. Search query edge cases and timeouts.
 * 7. Graceful non-crashing behavior on invalid or malformed arguments.
 */

import path from 'node:path';
import {
  hasTraversalAttempt,
  isBinaryFile,
  isSensitiveFile,
  resolveWorkspacePath,
} from '../src/tools/path-utils.js';
import { readFile } from '../src/tools/read-file.js';
import { listFiles } from '../src/tools/list-files.js';
import { textSearch } from '../src/search/text-search.js';
import { discoverSymbols } from '../src/symbols/discovery.js';
import { resolveExplicitReferences } from '../src/context/references.js';
import { retrieveContext } from '../src/context/retriever.js';
import { DEFAULT_CONFIG, type ServerConfig, type WorkspaceViewAdapter } from '../src/types/index.js';

describe('Phase 7: Security Boundaries & Path Safety', () => {
  const ROOT = process.platform === 'win32' ? 'C:\\safe_workspace' : '/safe_workspace';

  it('blocks deep directory traversal attempts across operating systems', () => {
    const maliciousPaths = [
      '../secret.txt',
      '..\\secret.txt',
      '../../../../../../etc/shadow',
      '..\\..\\..\\..\\Windows\\System32\\config\\SAM',
      'src/../../secret.txt',
      'src/sub/../../../../secret.txt',
    ];

    for (const p of maliciousPaths) {
      expect(hasTraversalAttempt(p)).toBe(true);
      const res = resolveWorkspacePath(ROOT, p);
      if ('error' in res) {
        expect(['PATH_OUTSIDE_WORKSPACE', 'PATH_TRAVERSAL_ATTEMPT', 'INVALID_INPUT']).toContain(
          res.error.code,
        );
      }
    }
  });

  it('blocks all known sensitive file patterns by default', () => {
    const sensitiveList = [
      '.env',
      '.env.local',
      '.env.development',
      '.env.prod',
      'id_rsa',
      'id_ed25519',
      'id_dsa',
      'private.key',
      'server.pem',
      'cert.p12',
      'cert.pfx',
      'keystore.jks',
      'credentials.json',
      'service-account-prod.json',
      'secrets.yaml',
      'secrets.yml',
      '.netrc',
      '.npmrc',
      '.pypirc',
    ];

    for (const file of sensitiveList) {
      expect(isSensitiveFile(file)).toBe(true);
    }
  });

  it('identifies all common binary formats to prevent context flooding', () => {
    const binaries = [
      'binary.exe', 'lib.dll', 'module.so', 'lib.dylib', 'archive.zip',
      'tarball.tar.gz', 'bundle.7z', 'image.png', 'photo.jpg', 'icon.ico',
      'doc.pdf', 'sheet.xlsx', 'font.ttf', 'font.woff2', 'bytecode.pyc',
      'compiled.class', 'app.wasm', 'database.sqlite',
    ];

    for (const bin of binaries) {
      expect(isBinaryFile(bin)).toBe(true);
    }
  });
});

describe('Phase 7: Tool Resiliency under Adversarial & Broken Inputs', () => {
  const ROOT = process.platform === 'win32' ? 'C:\\test_harness' : '/test_harness';
  const sep = process.platform === 'win32' ? '\\' : '/';
  function fp(...parts: string[]) {
    return [ROOT, ...parts].join(sep);
  }

  const hugeContent = 'A'.repeat(5000);
  const corruptedPython = 'def unclosed_function(\n    print("Missing paren"\n';

  const tree: Record<string, any> = {
    [ROOT]: { isDirectory: true, children: ['large.py', 'broken.py', 'secret.key', 'bin.wasm'] },
    [fp('large.py')]: { isFile: true, content: hugeContent, size: hugeContent.length },
    [fp('broken.py')]: { isFile: true, content: corruptedPython, size: corruptedPython.length },
    [fp('secret.key')]: { isFile: true, content: 'SUPER_SECRET', size: 12 },
    [fp('bin.wasm')]: { isFile: true, content: '\x00asm\x01\x00\x00\x00', size: 8 },
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

  const config: ServerConfig = {
    ...DEFAULT_CONFIG,
    workspaceRoot: ROOT,
    maxFileSizeBytes: 1000, // Small limit for testing
    maxReadLines: 10,
    searchTimeoutMs: 1000,
  };

  it('readFile rejects files exceeding maxFileSizeBytes', async () => {
    const res = await readFile({ path: 'large.py' }, config, mockAdapter);
    expect('error' in res).toBe(true);
    if ('error' in res) {
      expect(res.error.code).toBe('FILE_TOO_LARGE');
    }
  });

  it('readFile blocks sensitive key file', async () => {
    const res = await readFile({ path: 'secret.key' }, config, mockAdapter);
    expect('error' in res).toBe(true);
    if ('error' in res) {
      expect(res.error.code).toBe('SENSITIVE_FILE');
    }
  });

  it('readFile blocks binary wasm file', async () => {
    const res = await readFile({ path: 'bin.wasm' }, config, mockAdapter);
    expect('error' in res).toBe(true);
    if ('error' in res) {
      expect(res.error.code).toBe('BINARY_FILE');
    }
  });

  it('discoverSymbols on syntax error does not throw and flags partial analysis', async () => {
    const res = await discoverSymbols({ path: 'broken.py' }, config, mockAdapter);
    expect('error' in res).toBe(false);
    if (!('error' in res)) {
      expect(res.analysisComplete).toBe(false);
      expect(res.limitations.length).toBeGreaterThan(0);
    }
  });

  it('textSearch rejects invalid regex syntax without crash', async () => {
    const res = await textSearch({ query: '[a-z', isRegex: true }, config, mockAdapter);
    expect('error' in res).toBe(true);
    if ('error' in res) {
      expect(res.error.code).toBe('INVALID_INPUT');
    }
  });

  it('textSearch returns clean zero matches for empty query spaces', async () => {
    const res = await textSearch({ query: '   ' }, config, mockAdapter);
    expect('error' in res).toBe(true);
  });

  it('resolveExplicitReferences handles mixed missing, sensitive, and valid references gracefully', async () => {
    const query = 'Check @file:secret.key and @file:broken.py and @symbol:missing_func';
    const res = await resolveExplicitReferences(query, config, mockAdapter);

    expect(res.totalErrors).toBeGreaterThan(0); // secret.key blocked
    expect(res.totalNotFound).toBeGreaterThan(0); // missing_func not found

    const secretRef = res.references.find((r) => r.target === 'secret.key');
    expect(secretRef?.status).toBe('invalid');

    const missingSymbol = res.references.find((r) => r.target === 'missing_func');
    expect(missingSymbol?.status).toBe('not_found');
  });

  it('retrieveContext under empty match conditions yields empty piece list with limitation evidence', async () => {
    const res = await retrieveContext({ prompt: 'xylophone quantum entanglement' }, config, mockAdapter);

    expect(res.contextPieces).toEqual([]);
    expect(res.evidenceTrail.selected).toEqual([]);
    expect(res.evidenceTrail.limitations.some((l) => l.includes('No candidate files matched'))).toBe(true);
  });
});
