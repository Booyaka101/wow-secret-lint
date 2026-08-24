import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lint } from '../src/index.mjs';
import { analyzeSource } from '../src/analyze.mjs';
import { loadSnapshot } from '../src/apidata.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const REGRESSIONS = join(HERE, 'fixtures', 'regressions');

const dirs = readdirSync(REGRESSIONS, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

describe('regression fixtures reconstructed from real shipped traces', () => {
  it('has a fixture for every issue the corpus covers', () => {
    expect(dirs.length).toBeGreaterThanOrEqual(8);
  });

  for (const name of dirs) {
    it(name, async () => {
      const expected = JSON.parse(await readFile(join(REGRESSIONS, name, 'expected.json'), 'utf8'));
      const result = await lint(join('test', 'fixtures', 'regressions', name, 'input.lua'), {
        cwd: ROOT,
        conditional: expected.conditional ?? 'off',
      });
      expect(result.parseErrors).toEqual([]);

      const actual = result.findings.map((f) => ({
        ruleId: f.ruleId,
        line: f.line,
        severity: f.severity,
        api: f.api,
      }));
      expect(actual).toEqual(expected.findings);
    });
  }
});

describe('clean fixtures', () => {
  it('the guarded addon reports nothing and exits clean', async () => {
    const result = await lint('test/fixtures/clean', { cwd: ROOT });
    expect(result.parseErrors).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.filesScanned).toBe(2);
  });

  it('the permitted-operations file alone reports nothing', async () => {
    const result = await lint('test/fixtures/clean/Core/Permitted.lua', { cwd: ROOT });
    expect(result.findings).toEqual([]);
  });

  const permitted = [
    ['store in a variable', 'local hp = UnitHealth("player")\nlocal copy = hp\n'],
    ['store as a table value', 'local hp = UnitHealth("player")\nlocal t = {}\nt.hp = hp\n'],
    ['store as a table value in a constructor', 'local hp = UnitHealth("player")\nlocal t = { hp = hp }\n'],
    ['pass to a Lua function', 'local function keep(v) return v end\nlocal hp = UnitHealth("player")\nkeep(hp)\n'],
    ['concatenate a number secret', 'local hp = UnitHealth("player")\nlocal s = "hp " .. hp\n'],
    ['concatenate a string secret', 'local n = UnitSpellTargetName("player")\nlocal s = n .. "!"\n'],
    ['string.format', 'local hp = UnitHealth("player")\nlocal s = string.format("%d", hp)\n'],
    ['string.join', 'local hp = UnitHealth("player")\nlocal s = string.join(" ", hp)\n'],
    ['string.concat', 'local hp = UnitHealth("player")\nlocal s = string.concat(hp, "x")\n'],
    ['boolean test on a non-boolean secret', 'local hp = UnitHealth("player")\nif hp then return 1 end\n'],
    ['negated boolean test on a non-boolean secret', 'local hp = UnitHealth("player")\nif not hp then return 1 end\n'],
    ['return a secret', 'local function f() return UnitHealth("player") end\n'],
  ];

  let api;
  beforeAll(async () => {
    api = await loadSnapshot();
  });

  for (const [label, source] of permitted) {
    it(`never flags a permitted operation: ${label}`, () => {
      const { findings, parseError } = analyzeSource(source, 'x.lua', api);
      expect(parseError).toBeNull();
      expect(findings).toEqual([]);
    });
  }
});
