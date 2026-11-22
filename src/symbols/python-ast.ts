/**
 * ProofPatch MCP Server — Python AST Parser
 *
 * Invokes python-ast-worker.py via child process with pure JS regex fallback
 * if Python runtime is unavailable or parsing fails.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import type {
  SymbolConfidence,
  SymbolDiscoveryOutput,
  SymbolInfo,
} from '../types/index.js';

import fs from 'node:fs';

export interface CallSite {
  name: string;
  startLine: number;
  endLine: number;
  caller?: string | null;
  confidence: SymbolConfidence;
}

export interface PythonAnalysisResult extends SymbolDiscoveryOutput {
  calls: CallSite[];
}

let cachedPythonPath: string | null = null;

function getWorkerPath(): string {
  // Safe in both ESM and CJS (ts-jest / bundled)
  if (typeof __dirname !== 'undefined') {
    return path.resolve(__dirname, 'python-ast-worker.py');
  }
  return path.resolve(process.cwd(), 'src', 'symbols', 'python-ast-worker.py');
}

export async function findPythonPath(): Promise<string | null> {
  if (cachedPythonPath !== null) return cachedPythonPath;

  const candidates: string[] = [];

  // 1. Environment variable overrides (user / CI configured)
  if (process.env.PROOFPATCH_PYTHON_PATH) {
    candidates.push(process.env.PROOFPATCH_PYTHON_PATH);
  }
  if (process.env.PYTHON_PATH) {
    candidates.push(process.env.PYTHON_PATH);
  }

  // 2. Standard system binaries on PATH
  candidates.push('python3', 'python', 'py');

  // 3. Dynamic Windows user-level Python installations (no hardcoded usernames)
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const pyBaseDir = path.join(process.env.LOCALAPPDATA, 'Programs', 'Python');
    try {
      if (fs.existsSync(pyBaseDir)) {
        const subdirs = fs.readdirSync(pyBaseDir);
        for (const sub of subdirs) {
          const exePath = path.join(pyBaseDir, sub, 'python.exe');
          if (fs.existsSync(exePath)) {
            candidates.push(exePath);
          }
        }
      }
    } catch {
      // Ignore directory access errors
    }
  }

  for (const cmd of candidates) {
    const works = await new Promise<boolean>((resolve) => {
      const proc = spawn(cmd, ['-c', 'import ast; print(1)'], {
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 2000,
      });
      proc.on('error', () => resolve(false));
      proc.on('close', (code) => resolve(code === 0));
    });
    if (works) {
      cachedPythonPath = cmd;
      return cmd;
    }
  }

  return null;
}

/**
 * Parse Python code using Python's native AST module.
 */
export async function parsePythonWithAst(
  source: string,
  relativePath: string,
): Promise<PythonAnalysisResult> {
  const pythonCmd = await findPythonPath();
  if (!pythonCmd) {
    return fallbackRegexParser(source, relativePath, [
      'Python interpreter not available; fell back to lightweight structural scanner.',
    ]);
  }

  const workerPath = getWorkerPath();

  return new Promise((resolve) => {
    const proc = spawn(pythonCmd, [workerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      resolve(
        fallbackRegexParser(source, relativePath, [
          `Failed to execute Python AST worker: ${err.message}`,
        ]),
      );
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        resolve(
          fallbackRegexParser(source, relativePath, [
            `Python AST worker exited with code ${code}: ${stderr.trim()}`,
          ]),
        );
        return;
      }

      try {
        const parsed = JSON.parse(stdout);
        resolve({
          relativePath: parsed.relativePath || relativePath,
          language: 'python',
          symbols: parsed.symbols || [],
          calls: parsed.calls || [],
          analysisComplete: Boolean(parsed.analysisComplete),
          limitations: parsed.limitations || [],
        });
      } catch (e) {
        resolve(
          fallbackRegexParser(source, relativePath, [
            `Failed to parse AST worker output: ${String(e)}`,
          ]),
        );
      }
    });

    proc.stdin.write(JSON.stringify({ source, relativePath }));
    proc.stdin.end();
  });
}

/**
 * Fallback regex/heuristic parser when AST execution is unavailable.
 */
export function fallbackRegexParser(
  source: string,
  relativePath: string,
  extraLimitations: string[] = [],
): PythonAnalysisResult {
  const lines = source.split('\n');
  const symbols: SymbolInfo[] = [];
  const calls: CallSite[] = [];

  let currentClass: string | null = null;
  let currentIndent = 0;
  const pendingDecorators: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) continue;

    const indentMatch = line.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1].length : 0;

    if (currentClass && indent <= currentIndent) {
      currentClass = null;
    }

    if (trimmed.startsWith('@')) {
      const decName = trimmed.slice(1).split('(')[0].trim();
      pendingDecorators.push(decName);
      continue;
    }

    // Class definition
    const classMatch = trimmed.match(/^class\s+([A-Za-z0-9_]+)/);
    if (classMatch) {
      currentClass = classMatch[1];
      currentIndent = indent;
      symbols.push({
        name: classMatch[1],
        kind: 'class',
        relativePath,
        startLine: lineNum,
        endLine: lineNum,
        confidence: 'likely',
        decorators: pendingDecorators.length > 0 ? [...pendingDecorators] : undefined,
      });
      pendingDecorators.length = 0;
      continue;
    }

    // Function or Method definition
    const funcMatch = trimmed.match(/^(?:async\s+)?def\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/);
    if (funcMatch) {
      const isMethod = currentClass !== null && indent > currentIndent;
      const params = funcMatch[2]
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);

      symbols.push({
        name: funcMatch[1],
        kind: isMethod ? 'method' : 'function',
        relativePath,
        startLine: lineNum,
        endLine: lineNum,
        confidence: 'likely',
        parent: isMethod ? currentClass! : undefined,
        decorators: pendingDecorators.length > 0 ? [...pendingDecorators] : undefined,
        parameters: params,
      });
      pendingDecorators.length = 0;
      continue;
    }

    // Imports
    const importFromMatch = trimmed.match(/^from\s+([A-Za-z0-9_.]+)\s+import\s+(.+)/);
    if (importFromMatch) {
      const mod = importFromMatch[1];
      const names = importFromMatch[2].split(',').map((n) => n.trim().split(/\s+as\s+/)[0]);
      for (const n of names) {
        if (n) {
          symbols.push({
            name: n,
            kind: 'import',
            relativePath,
            startLine: lineNum,
            endLine: lineNum,
            confidence: 'likely',
            importSource: `${mod}.${n}`,
          });
        }
      }
      continue;
    }

    const importMatch = trimmed.match(/^import\s+(.+)/);
    if (importMatch) {
      const names = importMatch[1].split(',').map((n) => n.trim().split(/\s+as\s+/)[0]);
      for (const n of names) {
        if (n) {
          symbols.push({
            name: n,
            kind: 'import',
            relativePath,
            startLine: lineNum,
            endLine: lineNum,
            confidence: 'likely',
            importSource: n,
          });
        }
      }
      continue;
    }

    // Calls (heuristic)
    const callMatch = trimmed.match(/([A-Za-z0-9_]+)\s*\(/);
    if (callMatch && !['if', 'while', 'for', 'with', 'return', 'print'].includes(callMatch[1])) {
      calls.push({
        name: callMatch[1],
        startLine: lineNum,
        endLine: lineNum,
        confidence: 'possible',
      });
    }

    pendingDecorators.length = 0;
  }

  return {
    relativePath,
    language: 'python',
    symbols,
    calls,
    analysisComplete: false,
    limitations: [
      'Regex heuristic parsing used; line end ranges and complex nestings are approximate.',
      ...extraLimitations,
    ],
  };
}
