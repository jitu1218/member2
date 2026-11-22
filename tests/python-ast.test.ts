/**
 * Unit tests for Python AST parsing and symbol discovery.
 */

import { parsePythonWithAst, fallbackRegexParser, findPythonPath } from '../src/symbols/python-ast.js';
import { discoverSymbols } from '../src/symbols/discovery.js';
import { DEFAULT_CONFIG, type WorkspaceViewAdapter } from '../src/types/index.js';

const sampleFlaskHelpers = `
import os
import sys
from typing import Optional, Union
from .utils import get_env_var

DEBUG_ENV_VAR = "FLASK_DEBUG"

def get_debug_flag() -> bool:
    """Return whether debug mode should be enabled."""
    val = os.environ.get(DEBUG_ENV_VAR)
    if val is not None:
        return val.lower() not in ("0", "false", "no", "off", "n")
    return False

@decorator_a
@decorator_b(param="val")
def calculate_metrics(items, *args, **kwargs):
    result = compute(items)
    return result

class ConfigLoader:
    def __init__(self, app_name):
        self.app_name = app_name

    def load_defaults(self):
        self.setup()
        return {}
`;

describe('Python AST Symbol Parser', () => {
  it('extracts functions, methods, classes, and decorators accurately via AST', async () => {
    const result = await parsePythonWithAst(sampleFlaskHelpers, 'src/flask/helpers.py');

    expect(result.language).toBe('python');
    expect(result.relativePath).toBe('src/flask/helpers.py');

    const names = result.symbols.map((s) => s.name);
    expect(names).toContain('get_debug_flag');
    expect(names).toContain('calculate_metrics');
    expect(names).toContain('ConfigLoader');
    expect(names).toContain('__init__');
    expect(names).toContain('load_defaults');
    expect(names).toContain('os');
    expect(names).toContain('sys');
    expect(names).toContain('get_env_var');

    const debugFunc = result.symbols.find((s) => s.name === 'get_debug_flag')!;
    expect(debugFunc.kind).toBe('function');
    expect(debugFunc.confidence).toBe('confirmed');
    expect(debugFunc.startLine).toBeGreaterThan(0);
    expect(debugFunc.endLine).toBeGreaterThanOrEqual(debugFunc.startLine);

    const decoratedFunc = result.symbols.find((s) => s.name === 'calculate_metrics')!;
    expect(decoratedFunc.decorators).toBeDefined();
    expect(decoratedFunc.decorators).toContain('decorator_a');
    expect(decoratedFunc.parameters).toContain('items');
    expect(decoratedFunc.parameters).toContain('*args');
    expect(decoratedFunc.parameters).toContain('**kwargs');

    const method = result.symbols.find((s) => s.name === 'load_defaults')!;
    expect(method.kind).toBe('method');
    expect(method.parent).toBe('ConfigLoader');

    // Call site detection
    const calls = result.calls.map((c) => c.name);
    expect(calls).toContain('os.environ.get');
    expect(calls).toContain('compute');
    expect(calls).toContain('self.setup');
  });

  it('handles syntax errors gracefully without throwing', async () => {
    const brokenCode = 'def invalid_python_syntax(:\n  broken code';
    const result = await parsePythonWithAst(brokenCode, 'broken.py');

    expect(result.analysisComplete).toBe(false);
    expect(result.limitations.length).toBeGreaterThan(0);
    expect(result.limitations[0]).toMatch(/syntax error/i);
    expect(result.symbols).toEqual([]);
  });

  it('fallbackRegexParser extracts structural symbols accurately', () => {
    const result = fallbackRegexParser(sampleFlaskHelpers, 'src/flask/helpers.py');

    expect(result.language).toBe('python');
    const names = result.symbols.map((s) => s.name);
    expect(names).toContain('get_debug_flag');
    expect(names).toContain('calculate_metrics');
    expect(names).toContain('ConfigLoader');
    expect(names).toContain('__init__');
    expect(names).toContain('load_defaults');
    expect(result.analysisComplete).toBe(false);
  });

  it('findPythonPath dynamically finds available Python without hardcoded paths', async () => {
    const py = await findPythonPath();
    expect(py).not.toBeNull();
    expect(typeof py).toBe('string');
  });
});

describe('discoverSymbols tool runner', () => {
  const ROOT = process.platform === 'win32' ? 'C:\\workspace' : '/workspace';
  const config = { ...DEFAULT_CONFIG, workspaceRoot: ROOT };

  const mockAdapter: WorkspaceViewAdapter = {
    async readFile(p: string) {
      if (p.endsWith('helpers.py')) return sampleFlaskHelpers;
      if (p.endsWith('index.ts')) return 'export const x = 1;';
      throw new Error(`ENOENT: ${p}`);
    },
    async fileExists(p: string) {
      return p.endsWith('helpers.py') || p.endsWith('index.ts');
    },
    async fileStat(p: string) {
      if (p.endsWith('helpers.py')) return { size: sampleFlaskHelpers.length, isFile: true, isDirectory: false };
      if (p.endsWith('index.ts')) return { size: 22, isFile: true, isDirectory: false };
      return null;
    },
    async readDirectory() {
      return [];
    },
  };

  it('runs symbol discovery for Python file successfully', async () => {
    const res = await discoverSymbols({ path: 'src/helpers.py' }, config, mockAdapter);
    expect('error' in res).toBe(false);
    if (!('error' in res)) {
      expect(res.language).toBe('python');
      expect(res.symbols.length).toBeGreaterThan(0);
    }
  });

  it('explicitly reports unsupported analysis for non-Python file', async () => {
    const res = await discoverSymbols({ path: 'src/index.ts' }, config, mockAdapter);
    expect('error' in res).toBe(false);
    if (!('error' in res)) {
      expect(res.analysisComplete).toBe(false);
      expect(res.limitations[0]).toContain('currently targets Python');
    }
  });

  it('rejects path traversal attempts', async () => {
    const res = await discoverSymbols({ path: '../../etc/passwd' }, config, mockAdapter);
    expect('error' in res).toBe(true);
    if ('error' in res) {
      expect(res.error.code).toBe('PATH_OUTSIDE_WORKSPACE');
    }
  });
});
