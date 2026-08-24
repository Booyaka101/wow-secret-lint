import { describe, it, expect } from 'vitest';
import { formatStylish, formatJson, formatGithub, format } from '../src/report.mjs';

const result = {
  version: '1.0.0',
  filesScanned: 1,
  snapshot: {
    source: 'Gethe/wow-ui-source@live',
    generated: '2026-08-24T00:00:00.000Z',
    functionCount: 10098,
    secretReturnCount: 20,
    conditionalCount: 310,
  },
  warningsBeforeLint: ['Broken.toc: listed file not found on disk: Core/Absent.lua'],
  parseErrors: [],
  findings: [
    {
      file: 'Core/UnitFrame.lua',
      line: 3,
      column: 13,
      severity: 'error',
      ruleId: 'WSL001',
      message: "arithmetic on a secret value: 'hp' derives from UnitHealth() (SecretReturns=true)",
      api: 'UnitHealth',
      conditions: null,
    },
    {
      file: 'Core/UnitFrame.lua',
      line: 4,
      column: 4,
      severity: 'warning',
      ruleId: 'WSL010',
      message: "'cd' derives from C_Spell.GetSpellCooldown() which is secret while, x is active",
      api: null,
      conditions: ['SecretWhenCooldownsRestricted'],
    },
  ],
};

describe('stylish reporter', () => {
  const out = formatStylish(result);

  it('aligns the location and severity columns', () => {
    const lines = out.split('\n');
    expect(lines[0]).toBe('Broken.toc: listed file not found on disk: Core/Absent.lua');
    expect(lines[1]).toBe(
      "Core/UnitFrame.lua:3:13  error    WSL001  arithmetic on a secret value: 'hp' derives from UnitHealth() (SecretReturns=true)"
    );
    expect(lines[2].startsWith('Core/UnitFrame.lua:4:4   warning  WSL010')).toBe(true);
  });

  it('ends with a singular/plural correct summary', () => {
    expect(out.split('\n').at(-1)).toBe('1 error, 1 warning');
  });

  it('counts parse errors separately', () => {
    const withParse = {
      ...result,
      findings: [],
      parseErrors: [{ file: 'a.lua', line: 2, column: 1, message: "')' expected near 'if'" }],
    };
    const lines = formatStylish(withParse).split('\n');
    expect(lines).toContain("a.lua:2:1  parse error  ')' expected near 'if'");
    expect(lines.at(-1)).toBe('1 parse error, 0 errors, 0 warnings');
  });

  it('says zero cleanly', () => {
    const clean = { ...result, findings: [], warningsBeforeLint: [] };
    expect(formatStylish(clean)).toBe('0 errors, 0 warnings');
  });
});

describe('json reporter', () => {
  const parsed = JSON.parse(formatJson(result));

  it('is valid JSON carrying every finding field', () => {
    expect(parsed.findings).toHaveLength(2);
    expect(parsed.findings[0]).toMatchObject({
      file: 'Core/UnitFrame.lua',
      line: 3,
      column: 13,
      severity: 'error',
      ruleId: 'WSL001',
      api: 'UnitHealth',
    });
  });

  it('carries the snapshot provenance and the summary', () => {
    expect(parsed.snapshot.functionCount).toBe(10098);
    expect(parsed.summary).toEqual({ errors: 1, warnings: 1, parseErrors: 0 });
  });
});

describe('github reporter', () => {
  const out = formatGithub(result);
  const lines = out.split('\n');

  it('emits a valid ::error annotation with file, line and col', () => {
    expect(lines[1]).toMatch(/^::error file=Core\/UnitFrame\.lua,line=3,col=13,title=[^:]/);
    expect(lines[1]).toMatch(/::WSL001%3A arithmetic on a secret value/);
  });

  it('emits ::warning for warning severity', () => {
    expect(lines[2]).toMatch(/^::warning file=Core\/UnitFrame\.lua,line=4,col=4,/);
  });

  it('escapes the workflow-command delimiters in messages', () => {
    for (const line of lines) {
      const body = line.slice(line.indexOf('::', 2) + 2);
      expect(body).not.toContain('\n');
      expect(body.includes(':') && !body.includes('%3A')).toBe(false);
    }
  });

  it('promotes pre-lint warnings to ::warning', () => {
    expect(lines[0]).toBe('::warning::Broken.toc%3A listed file not found on disk%3A Core/Absent.lua');
  });

  it('ends with a notice summary', () => {
    expect(lines.at(-1)).toBe('::notice::1 error, 1 warning from wow-secret-lint');
  });
});

describe('format dispatcher', () => {
  it('rejects an unknown format', () => {
    expect(() => format(result, 'nope')).toThrow(/unknown format "nope"/);
  });
});
