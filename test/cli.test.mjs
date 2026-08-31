import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const BIN = join(ROOT, 'bin', 'wow-secret-lint.mjs');

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

describe('cli', () => {
  it('exits 0 with no findings on the clean fixture', async () => {
    const r = await run(['test/fixtures/clean']);
    expect(r.stdout.trim()).toBe('0 errors, 0 warnings');
    expect(r.code).toBe(0);
  });

  it('reproduces the documented worked example byte for byte', async () => {
    const r = await run(['--strict', 'Core/UnitFrame.lua'], join(HERE, 'fixtures', 'worked-example'));
    expect(r.stdout).toBe(
      [
        "Core/UnitFrame.lua:3:13  error  WSL001  arithmetic on a secret value: 'hp' derives from UnitHealth() (SecretReturns=true)",
        "Core/UnitFrame.lua:4:4   error  WSL002  comparison of a secret value: 'hp' derives from UnitHealth() (SecretReturns=true)",
        '2 errors, 0 warnings',
        '',
      ].join('\n')
    );
    expect(r.code).toBe(1);
  });

  it('exits 0 once the worked example is guarded', async () => {
    const r = await run(['--strict', 'Core/Guarded.lua'], join(HERE, 'fixtures', 'worked-example'));
    expect(r.stdout.trim()).toBe('0 errors, 0 warnings');
    expect(r.code).toBe(0);
  });

  it('exits 2 and reports a parse error without a stack trace', async () => {
    const r = await run(['test/fixtures/parse-error']);
    expect(r.stdout).toMatch(/broken\.lua:2:1\s+parse error/);
    expect(r.stdout).not.toMatch(/at .*\.mjs:/);
    expect(r.code).toBe(2);
  });

  it('warns about a .toc entry that is missing on disk and keeps going', async () => {
    const r = await run(['test/fixtures/toc-missing']);
    expect(r.stdout).toMatch(/listed file not found on disk: Core\/Absent\.lua/);
    expect(r.stdout).toMatch(/Core\/Present\.lua:2:17\s+warning\s+WSL001/);
    expect(r.code).toBe(0);
  });

  it('emits valid GitHub annotations', async () => {
    const r = await run(['--strict', '--format=github', 'test/fixtures/rules/every-rule.lua']);
    const lines = r.stdout.trim().split('\n');
    expect(lines.filter((l) => /^::error file=[^,]+,line=\d+,col=\d+,title=/.test(l)).length).toBe(8);
    expect(lines.filter((l) => /^::warning file=/.test(l)).length).toBe(1);
    expect(lines.at(-1)).toMatch(/^::notice::8 errors, 1 warning/);
  });

  it('emits parseable JSON', async () => {
    const r = await run(['--strict', '--format=json', 'test/fixtures/rules/every-rule.lua']);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.summary.errors).toBe(8);
    expect(parsed.findings[0].ruleId).toBe('WSL001');
  });

  it('exits 0 immediately for classic', async () => {
    const r = await run(['--game=classic', 'test/fixtures/rules/every-rule.lua']);
    expect(r.stdout.trim()).toBe('classic has no secret values; nothing to check');
    expect(r.code).toBe(0);
  });

  it('honours --disable', async () => {
    const r = await run(['--disable=WSL001,WSL002', '--format=json', 'test/fixtures/rules/every-rule.lua']);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.findings.map((f) => f.ruleId)).not.toContain('WSL001');
    expect(parsed.findings.map((f) => f.ruleId)).not.toContain('WSL002');
  });

  const COOLDOWN = 'test/fixtures/regressions/btwloadouts-67-unguarded-cooldown-compare/input.lua';

  it('honours --max-warnings', async () => {
    const strict = await run(['--conditional=warn', '--max-warnings=0', COOLDOWN]);
    expect(strict.code).toBe(1);
    const loose = await run(['--conditional=warn', COOLDOWN]);
    expect(loose.code).toBe(0);
  });

  it('leaves conditionally secret APIs alone by default', async () => {
    const r = await run([COOLDOWN]);
    expect(r.stdout.trim()).toBe('0 errors, 0 warnings');
    expect(r.code).toBe(0);
  });

  it('surfaces conditionally secret APIs with --conditional=warn', async () => {
    const r = await run(['--conditional=warn', COOLDOWN]);
    expect(r.stdout).toMatch(/warning\s+WSL002\s+comparison of a secret value/);
    expect(r.stdout).toMatch(/SecretWhenCooldownsRestricted/);
    expect(r.code).toBe(0);
  });

  it('raises conditional findings to errors with --conditional=error', async () => {
    const r = await run(['--conditional=error', COOLDOWN]);
    expect(r.stdout).toMatch(/error\s+WSL002/);
    expect(r.code).toBe(1);
  });

  it('honours --secret-guard for a custom wrapper name', async () => {
    const r = await run(['--strict', '--format=json', '--secret-guard=IsSecret', 'test/fixtures/rules/every-rule.lua']);
    expect(JSON.parse(r.stdout).summary.errors).toBe(8);
  });

  it('does not fail the build on SecretReturns findings by default', async () => {
    const r = await run(['Core/UnitFrame.lua'], join(HERE, 'fixtures', 'worked-example'));
    expect(r.stdout).toMatch(/warning\s+WSL001/);
    expect(r.code).toBe(0);
  });

  it('WSL008 alone fails the build with no flags, because it is deterministic', async () => {
    const r = await run(['test/fixtures/regressions/combat-log-event-registration/input.lua']);
    expect(r.code).toBe(1);
  });

  it('prints the rule table', async () => {
    const r = await run(['--rules']);
    expect(r.stdout).toMatch(/WSL001\s+error\s+arithmetic on a secret value/);
    expect(r.stdout).toMatch(/warcraft\.wiki\.gg\/wiki\/Secret_Values/);
    expect(r.code).toBe(0);
  });

  it('prints the version', async () => {
    const r = await run(['--version']);
    expect(r.stdout.trim()).toBe('1.4.1');
  });

  it('fails clearly on a path that does not exist', async () => {
    const r = await run(['no/such/place']);
    expect(r.stderr).toMatch(/no such file or directory: no\/such\/place/);
    expect(r.stderr).not.toMatch(/at .*\.mjs:/);
    expect(r.code).toBe(2);
  });

  it('fails clearly on an unknown option', async () => {
    const r = await run(['--nope', 'test/fixtures/clean']);
    expect(r.stderr).toMatch(/unknown option "--nope"/);
    expect(r.code).toBe(2);
  });

  it('fails clearly on an unknown format', async () => {
    const r = await run(['--format=xml', 'test/fixtures/clean']);
    expect(r.stderr).toMatch(/unknown format "xml"/);
    expect(r.code).toBe(2);
  });

  it('fails clearly on an unknown rule id in --disable', async () => {
    const r = await run(['--disable=WSL999', 'test/fixtures/clean']);
    expect(r.stderr).toMatch(/unknown rule id "WSL999"/);
    expect(r.code).toBe(2);
  });

  it('fails clearly on a missing snapshot', async () => {
    const r = await run(['--snapshot=no/such/snapshot.json', 'test/fixtures/clean']);
    expect(r.stderr).toMatch(/API snapshot missing/);
    expect(r.code).toBe(2);
  });

  it('prints usage when given no path', async () => {
    const r = await run([]);
    expect(r.stderr).toMatch(/no path given/);
    expect(r.stderr).toMatch(/Usage:/);
    expect(r.code).toBe(2);
  });

  it('rejects a non-Lua file with a clear message', async () => {
    const r = await run(['package.json']);
    expect(r.stderr).toMatch(/not a Lua or \.toc file/);
    expect(r.code).toBe(2);
  });
});
