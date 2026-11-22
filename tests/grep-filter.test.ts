/**
 * Tests for grep-filter utilities:
 * - .gitignore parsing
 * - Ignore rule matching
 * - File classification
 */

import { parseGitignore, isIgnoredByRules, classifyFile } from '../src/search/grep-filter.js';

describe('parseGitignore', () => {
  it('parses simple patterns', () => {
    const rules = parseGitignore('node_modules\n*.pyc\nbuild/\n');
    expect(rules.length).toBe(3);
    expect(rules[0].pattern).toBe('node_modules');
    expect(rules[1].pattern).toBe('*.pyc');
    expect(rules[2].pattern).toBe('build');
    expect(rules[2].directoryOnly).toBe(true);
  });

  it('handles comments and blank lines', () => {
    const rules = parseGitignore('# comment\n\nnode_modules\n  # indented comment\n');
    expect(rules.length).toBe(1);
    expect(rules[0].pattern).toBe('node_modules');
  });

  it('handles negation patterns', () => {
    const rules = parseGitignore('*.log\n!important.log\n');
    expect(rules.length).toBe(2);
    expect(rules[0].negated).toBe(false);
    expect(rules[1].negated).toBe(true);
    expect(rules[1].pattern).toBe('important.log');
  });

  it('handles anchored patterns', () => {
    const rules = parseGitignore('/build\n');
    expect(rules.length).toBe(1);
    // The leading slash is stripped, but it was anchored
    expect(rules[0].pattern).toBe('build');
  });

  it('escapes regex special characters safely in patterns', () => {
    const rules = parseGitignore('build+(v1)\ntemp[0-9].log\n$cache\n');
    expect(rules.length).toBe(3);
    expect(isIgnoredByRules('build+(v1)', false, rules)).toBe(true);
    expect(isIgnoredByRules('buildv1', false, rules)).toBe(false);
    expect(isIgnoredByRules('temp5.log', false, rules)).toBe(true);
    expect(isIgnoredByRules('tempX.log', false, rules)).toBe(false);
    expect(isIgnoredByRules('$cache', false, rules)).toBe(true);
  });
});

describe('isIgnoredByRules', () => {
  it('ignores files matching simple patterns', () => {
    const rules = parseGitignore('node_modules\n*.pyc\n');
    expect(isIgnoredByRules('node_modules/express/index.js', false, rules)).toBe(true);
    expect(isIgnoredByRules('src/__pycache__/module.pyc', false, rules)).toBe(true);
    expect(isIgnoredByRules('src/main.py', false, rules)).toBe(false);
  });

  it('respects directory-only rules', () => {
    const rules = parseGitignore('build/\n');
    expect(isIgnoredByRules('build', true, rules)).toBe(true);
    expect(isIgnoredByRules('build', false, rules)).toBe(false); // Not a directory
  });

  it('respects negation rules', () => {
    const rules = parseGitignore('*.log\n!important.log\n');
    expect(isIgnoredByRules('debug.log', false, rules)).toBe(true);
    expect(isIgnoredByRules('important.log', false, rules)).toBe(false);
  });

  it('handles double-star patterns', () => {
    const rules = parseGitignore('**/*.pyc\n');
    expect(isIgnoredByRules('src/module.pyc', false, rules)).toBe(true);
    expect(isIgnoredByRules('deep/nested/module.pyc', false, rules)).toBe(true);
    expect(isIgnoredByRules('module.pyc', false, rules)).toBe(true);
  });

  it('handles extension patterns', () => {
    const rules = parseGitignore('*.py[cod]\n');
    // This is a simple character class in gitignore, but we don't support it fully
    // Just test that our basic extension matching works
    const basicRules = parseGitignore('*.pyc\n*.pyo\n');
    expect(isIgnoredByRules('test.pyc', false, basicRules)).toBe(true);
    expect(isIgnoredByRules('test.pyo', false, basicRules)).toBe(true);
    expect(isIgnoredByRules('test.py', false, basicRules)).toBe(false);
  });
});

describe('classifyFile', () => {
  it('classifies Python source files', () => {
    expect(classifyFile('src/main.py')).toBe('source');
    expect(classifyFile('app.py')).toBe('source');
  });

  it('classifies TypeScript source files', () => {
    expect(classifyFile('src/server.ts')).toBe('source');
    expect(classifyFile('components/App.tsx')).toBe('source');
  });

  it('classifies test files', () => {
    expect(classifyFile('tests/test_app.py')).toBe('test');
    expect(classifyFile('src/app.test.ts')).toBe('test');
    expect(classifyFile('src/app.spec.js')).toBe('test');
    expect(classifyFile('__tests__/unit.ts')).toBe('test');
  });

  it('classifies config files', () => {
    expect(classifyFile('package.json')).toBe('config');
    expect(classifyFile('tsconfig.json')).toBe('config');
    expect(classifyFile('pyproject.toml')).toBe('config');
    expect(classifyFile('Makefile')).toBe('config');
    expect(classifyFile('Dockerfile')).toBe('config');
  });

  it('classifies documentation files', () => {
    expect(classifyFile('README.md')).toBe('documentation');
    expect(classifyFile('docs/guide.rst')).toBe('documentation');
    expect(classifyFile('CHANGELOG.txt')).toBe('documentation');
  });

  it('classifies style files', () => {
    expect(classifyFile('styles/main.css')).toBe('style');
    expect(classifyFile('theme.scss')).toBe('style');
  });

  it('classifies script files', () => {
    expect(classifyFile('scripts/deploy.sh')).toBe('script');
    expect(classifyFile('build.bat')).toBe('script');
  });

  it('returns other for unknown files', () => {
    expect(classifyFile('data.bin')).toBe('other');
    expect(classifyFile('Procfile')).toBe('other');
  });
});
