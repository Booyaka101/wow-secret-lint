// --baseline / --write-baseline: gate CI on new findings only.

import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBaseline, applyBaseline, readBaseline, BASELINE_VERSION } from '../src/baseline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const BIN = join(ROOT, 'bin', 'wow-secret-lint.mjs');
const EVERY = join('test', 'fixtures', 'rules', 'every-rule.lua');

function run(args, cwd = ROOT) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

const finding = (file, ruleId, message, line = 1) => ({ file, ruleId, message, line, column: 1, severity: 'error' });

describe('baseline matching', () => {
  it('keys on file, rule and message with a count, never on line numbers', () => {
    const a = finding('a.lua', 'WSL001', 'arithmetic on hp', 3);
    const b = finding('a.lua', 'WSL001', 'arithmetic on hp', 40);
    const base = buildBaseline({ patch: '12.1.5', findings: [a, b] });
    expect(base.entries).toEqual([{ file: 'a.lua', ruleId: 'WSL001', message: 'arithmetic on hp', count: 2 }]);

    const moved = [finding('a.lua', 'WSL001', 'arithmetic on hp', 90), finding('a.lua', 'WSL001', 'arithmetic on hp', 91)];
    expect(applyBaseline(moved, base)).toEqual({ findings: [], suppressed: 2, stale: 0 });
  });

  it('reports the finding that exceeds the recorded count, and the entries that no longer match', () => {
    const base = buildBaseline({
      patch: '12.1.5',
      findings: [finding('a.lua', 'WSL001', 'x'), finding('b.lua', 'WSL002', 'gone')],
    });
    const now = [finding('a.lua', 'WSL001', 'x', 1), finding('a.lua', 'WSL001', 'x', 2), finding('c.lua', 'WSL005', 'new')];
    const r = applyBaseline(now, base);
    expect(r.findings.map((f) => `${f.file}:${f.line}`)).toEqual(['a.lua:2', 'c.lua:1']);
    expect(r.suppressed).toBe(1);
    expect(r.stale).toBe(1);
  });

  it('sorts entries so two recordings diff cleanly', () => {
    const base = buildBaseline({
      patch: '12.1.5',
      findings: [finding('b.lua', 'WSL002', 'z'), finding('a.lua', 'WSL009', 'y'), finding('a.lua', 'WSL001', 'x')],
    });
    expect(base.entries.map((e) => `${e.file} ${e.ruleId}`)).toEqual(['a.lua WSL001', 'a.lua WSL009', 'b.lua WSL002']);
    expect(base.version).toBe(BASELINE_VERSION);
    expect(base.tool).toBe('wow-secret-lint');
  });
});

describe('baseline files', () => {
  let dir;
  const setup = async () => (dir = await mkdtemp(join(tmpdir(), 'wsl-baseline-')));
  const teardown = () => rm(dir, { recursive: true, force: true });

  it('rejects a missing, malformed or foreign file with a clear message', async () => {
    await setup();
    try {
      await expect(readBaseline(join(dir, 'none.json'))).rejects.toThrow(/baseline file not found: .*none\.json\. Record one with --write-baseline=/);
      const bad = join(dir, 'bad.json');
      await writeFile(bad, '{ not json', 'utf8');
      await expect(readBaseline(bad)).rejects.toThrow(/not valid JSON/);
      const foreign = join(dir, 'foreign.json');
      await writeFile(foreign, JSON.stringify({ tool: 'eslint', entries: [] }), 'utf8');
      await expect(readBaseline(foreign)).rejects.toThrow(/not a wow-secret-lint baseline/);
      const future = join(dir, 'future.json');
      await writeFile(future, JSON.stringify({ tool: 'wow-secret-lint', version: 99, entries: [] }), 'utf8');
      await expect(readBaseline(future)).rejects.toThrow(/version 99/);
      const broken = join(dir, 'entry.json');
      await writeFile(broken, JSON.stringify({ tool: 'wow-secret-lint', version: 1, entries: [{ file: 'a', ruleId: 'WSL001', message: 'm', count: 0 }] }), 'utf8');
      await expect(readBaseline(broken)).rejects.toThrow(/entry 0 has no positive integer count/);
    } finally {
      await teardown();
    }
  });

  it('records with --write-baseline, then reports nothing new against it', async () => {
    await setup();
    try {
      const path = join(dir, 'baseline.json');
      const wrote = await run(['--strict', `--write-baseline=${path}`, EVERY]);
      expect(wrote.code).toBe(0);
      expect(wrote.stderr).toMatch(/wrote .*baseline\.json: 9 entries covering 9 findings/);
      expect(wrote.stdout).toMatch(/8 errors, 1 warning/);
      const recorded = JSON.parse(await readFile(path, 'utf8'));
      expect(recorded.entries.every((e) => e.file === 'test/fixtures/rules/every-rule.lua')).toBe(true);
      expect(recorded.patch).toBe('12.1.5');

      const clean = await run(['--strict', `--baseline=${path}`, EVERY]);
      expect(clean.code).toBe(0);
      expect(clean.stdout.trim().split('\n')).toEqual([
        `9 findings suppressed by baseline ${path}`,
        '0 errors, 0 warnings',
      ]);

      const json = await run(['--strict', `--baseline=${path}`, '--format=json', EVERY]);
      const parsed = JSON.parse(json.stdout);
      expect(parsed.baseline).toEqual({ path, suppressed: 9, stale: 0 });
      expect(parsed.findings).toEqual([]);

      const github = await run(['--strict', `--baseline=${path}`, '--format=github', EVERY]);
      expect(github.stdout).toMatch(/^::notice::9 findings suppressed by baseline /m);
    } finally {
      await teardown();
    }
  });

  it('still fails the build on a finding the baseline does not know', async () => {
    await setup();
    try {
      const path = join(dir, 'baseline.json');
      await run([`--write-baseline=${path}`, 'test/fixtures/clean']);
      const r = await run([`--baseline=${path}`, 'test/fixtures/worked-example-1215']);
      expect(r.code).toBe(1);
      expect(r.stdout).toMatch(/WSL019/);
      expect(r.stdout).toMatch(/0 findings suppressed by baseline/);
    } finally {
      await teardown();
    }
  });

  it('refuses both flags at once and a baseline that does not exist', async () => {
    const both = await run(['--baseline=a.json', '--write-baseline=b.json', 'test/fixtures/clean']);
    expect(both.stderr).toMatch(/either --baseline or --write-baseline/);
    expect(both.code).toBe(2);
    const missing = await run(['--baseline=no/such/baseline.json', 'test/fixtures/clean']);
    expect(missing.stderr).toMatch(/baseline file not found/);
    expect(missing.code).toBe(2);
  });
});
