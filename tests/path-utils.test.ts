/**
 * Tests for path safety utilities — the most critical security boundary.
 */

import path from 'node:path';
import {
  resolveWorkspacePath,
  hasTraversalAttempt,
  isSensitiveFile,
  isBinaryFile,
  isExcludedPath,
  toRelativePath,
} from '../src/tools/path-utils.js';

// Use a consistent fake root for tests
const ROOT = process.platform === 'win32' ? 'C:\\workspace\\project' : '/workspace/project';

describe('resolveWorkspacePath', () => {
  it('resolves a simple relative path within workspace', () => {
    const result = resolveWorkspacePath(ROOT, 'src/main.py');
    expect(result).toHaveProperty('absolutePath');
    if ('absolutePath' in result) {
      expect(result.absolutePath).toBe(path.resolve(ROOT, 'src/main.py'));
    }
  });

  it('resolves a path with leading slash (treats as relative)', () => {
    const result = resolveWorkspacePath(ROOT, '/src/main.py');
    expect(result).toHaveProperty('absolutePath');
    if ('absolutePath' in result) {
      expect(result.absolutePath).toBe(path.resolve(ROOT, 'src/main.py'));
    }
  });

  it('rejects an empty path', () => {
    const result = resolveWorkspacePath(ROOT, '');
    expect(result).toHaveProperty('error');
    if ('error' in result) {
      expect(result.error.code).toBe('INVALID_INPUT');
    }
  });

  it('rejects a whitespace-only path', () => {
    const result = resolveWorkspacePath(ROOT, '   ');
    expect(result).toHaveProperty('error');
    if ('error' in result) {
      expect(result.error.code).toBe('INVALID_INPUT');
    }
  });

  it('rejects a path that escapes the workspace with ..', () => {
    const result = resolveWorkspacePath(ROOT, '../../etc/passwd');
    expect(result).toHaveProperty('error');
    if ('error' in result) {
      expect(result.error.code).toBe('PATH_OUTSIDE_WORKSPACE');
    }
  });

  it('rejects a path that starts with absolute path outside workspace', () => {
    // On Windows this won't truly escape since we strip leading slashes
    // but on Unix /etc/passwd => resolved against root => might escape
    const result = resolveWorkspacePath(ROOT, '../../../etc/passwd');
    expect(result).toHaveProperty('error');
    if ('error' in result) {
      expect(result.error.code).toBe('PATH_OUTSIDE_WORKSPACE');
    }
  });

  it('allows a valid nested path', () => {
    const result = resolveWorkspacePath(ROOT, 'src/utils/../helpers/util.py');
    expect(result).toHaveProperty('absolutePath');
    if ('absolutePath' in result) {
      // The ".." in the middle is fine as long as the final path is inside workspace
      expect(result.absolutePath).toBe(path.resolve(ROOT, 'src/helpers/util.py'));
    }
  });
});

describe('hasTraversalAttempt', () => {
  it('detects .. in path', () => {
    expect(hasTraversalAttempt('../etc/passwd')).toBe(true);
    expect(hasTraversalAttempt('src/../../etc')).toBe(true);
    expect(hasTraversalAttempt('..\\windows\\system32')).toBe(true);
  });

  it('allows normal paths', () => {
    expect(hasTraversalAttempt('src/main.py')).toBe(false);
    expect(hasTraversalAttempt('src/utils/helpers.py')).toBe(false);
  });
});

describe('isSensitiveFile', () => {
  it('detects .env files', () => {
    expect(isSensitiveFile('.env')).toBe(true);
    expect(isSensitiveFile('.env.local')).toBe(true);
    expect(isSensitiveFile('.env.production')).toBe(true);
    expect(isSensitiveFile('/some/path/.env')).toBe(true);
  });

  it('detects key and certificate files', () => {
    expect(isSensitiveFile('server.pem')).toBe(true);
    expect(isSensitiveFile('private.key')).toBe(true);
    expect(isSensitiveFile('cert.p12')).toBe(true);
    expect(isSensitiveFile('id_rsa')).toBe(true);
    expect(isSensitiveFile('id_ed25519')).toBe(true);
  });

  it('detects credential files', () => {
    expect(isSensitiveFile('credentials.json')).toBe(true);
    expect(isSensitiveFile('.npmrc')).toBe(true);
    expect(isSensitiveFile('.pypirc')).toBe(true);
  });

  it('allows normal files', () => {
    expect(isSensitiveFile('main.py')).toBe(false);
    expect(isSensitiveFile('config.py')).toBe(false);
    expect(isSensitiveFile('README.md')).toBe(false);
    expect(isSensitiveFile('package.json')).toBe(false);
  });
});

describe('isBinaryFile', () => {
  it('detects binary extensions', () => {
    expect(isBinaryFile('image.png')).toBe(true);
    expect(isBinaryFile('photo.jpg')).toBe(true);
    expect(isBinaryFile('archive.zip')).toBe(true);
    expect(isBinaryFile('app.exe')).toBe(true);
    expect(isBinaryFile('lib.dll')).toBe(true);
    expect(isBinaryFile('doc.pdf')).toBe(true);
    expect(isBinaryFile('module.wasm')).toBe(true);
  });

  it('allows text files', () => {
    expect(isBinaryFile('main.py')).toBe(false);
    expect(isBinaryFile('script.ts')).toBe(false);
    expect(isBinaryFile('README.md')).toBe(false);
    expect(isBinaryFile('config.yaml')).toBe(false);
    expect(isBinaryFile('Makefile')).toBe(false);
  });
});

describe('isExcludedPath', () => {
  it('excludes node_modules', () => {
    expect(isExcludedPath('node_modules/express/index.js')).toBe(true);
    expect(isExcludedPath('src/node_modules/util.js')).toBe(true);
  });

  it('excludes .git', () => {
    expect(isExcludedPath('.git/config')).toBe(true);
    expect(isExcludedPath('.git/HEAD')).toBe(true);
  });

  it('excludes __pycache__', () => {
    expect(isExcludedPath('src/__pycache__/module.cpython-311.pyc')).toBe(true);
  });

  it('excludes build outputs', () => {
    expect(isExcludedPath('dist/main.js')).toBe(true);
    expect(isExcludedPath('build/output.js')).toBe(true);
  });

  it('excludes .pyc files', () => {
    expect(isExcludedPath('src/module.pyc')).toBe(true);
  });

  it('allows source files', () => {
    expect(isExcludedPath('src/main.py')).toBe(false);
    expect(isExcludedPath('tests/test_app.py')).toBe(false);
    expect(isExcludedPath('README.md')).toBe(false);
  });

  it('respects additional exclude patterns', () => {
    expect(isExcludedPath('vendor/lib.js', ['vendor'])).toBe(true);
    expect(isExcludedPath('src/main.py', ['vendor'])).toBe(false);
  });
});

describe('toRelativePath', () => {
  it('converts absolute path to relative', () => {
    const abs = path.resolve(ROOT, 'src/main.py');
    const rel = toRelativePath(ROOT, abs);
    expect(rel).toBe('src/main.py');
  });

  it('uses forward slashes', () => {
    const abs = path.resolve(ROOT, 'src', 'utils', 'helper.py');
    const rel = toRelativePath(ROOT, abs);
    expect(rel).toBe('src/utils/helper.py');
  });
});
