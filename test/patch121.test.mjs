// The 12.1 rule surface: WSL012-WSL017 plus the --patch flag that gates it.

import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeSource } from '../src/analyze.mjs';
import { loadSnapshot } from '../src/apidata.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const BIN = join(ROOT, 'bin', 'wow-secret-lint.mjs');
const FIXTURES = join(HERE, 'fixtures', 'rules-121');

let api;
beforeAll(async () => {
  api = await loadSnapshot();
});

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

function ids(source, options) {
  const { findings, parseError } = analyzeSource(source, 'x.lua', api, options);
  expect(parseError).toBeNull();
  return findings.map((f) => `${f.ruleId}@${f.line}`);
}

async function lintFixture(name, options) {
  const source = await readFile(join(FIXTURES, name), 'utf8');
  const { findings, parseError } = analyzeSource(source, name, api, options);
  expect(parseError).toBeNull();
  return findings;
}

// Rule id and line for every finding each violating fixture must produce, in order.
const VIOLATING = {
  'wsl012-violating.lua': [
    'WSL012@3', // # length
    'WSL012@5', // numeric indexing
    'WSL012@8', // ipairs iteration
    'WSL012@11', // pairs iteration
    'WSL012@16', // secret as a table key
    'WSL012@18', // reassigned through a local, still tainted
  ],
  'wsl013-violating.lua': [
    'WSL013@3', // comparison
    'WSL013@6', // arithmetic on a later return position
    'WSL013@9', // table key
    'WSL013@11', // comparison
    'WSL013@14', // arithmetic
    'WSL013@15', // boolean test, documented bool
    'WSL013@18', // boolean test, documented bool
    'WSL013@23', // reassigned through a local, still tainted
  ],
  'wsl014-violating.lua': ['WSL014@2', 'WSL014@3', 'WSL014@6', 'WSL014@7', 'WSL014@8'],
  'wsl015-violating.lua': ['WSL015@2', 'WSL015@3'],
  'wsl016-violating.lua': ['WSL016@6', 'WSL016@14'],
  'wsl017-violating.lua': [
    'WSL017@3', // container RegisterEvent
    'WSL017@4', // container RegisterUnitEvent
    'WSL017@8', // button SetScript
    'WSL017@9', // button HookScript
    'WSL017@10', // button RegisterEvent
    'WSL017@11', // button EnableMouse
    'WSL017@12', // button RegisterForClicks
    'WSL017@13', // button IsMouseOver
    'WSL017@19', // directly created button
  ],
};

describe('12.1 rule fixtures', () => {
  for (const [name, expected] of Object.entries(VIOLATING)) {
    it(`${name} produces exactly the documented findings`, async () => {
      const findings = await lintFixture(name);
      expect(findings.map((f) => `${f.ruleId}@${f.line}`)).toEqual(expected);
    });

    it(`${name} is silent under --patch 12.0`, async () => {
      expect(await lintFixture(name, { patch: '12.0' })).toEqual([]);
    });

    const clean = name.replace('violating', 'clean');
    it(`${clean} reports nothing`, async () => {
      expect(await lintFixture(clean)).toEqual([]);
    });
  }

  it('WSL012 and WSL013 findings are errors without --strict', async () => {
    const severities = (await lintFixture('wsl012-violating.lua')).map((f) => f.severity);
    expect(new Set(severities)).toEqual(new Set(['error']));
  });

  it('WSL015 and WSL016 findings stay warnings', async () => {
    for (const name of ['wsl015-violating.lua', 'wsl016-violating.lua']) {
      const severities = (await lintFixture(name)).map((f) => f.severity);
      expect(new Set(severities)).toEqual(new Set(['warning']));
    }
  });
});

describe('12.1 taint behaviour', () => {
  it('taints all aura query shapes', () => {
    for (const call of [
      'C_UnitAuras.GetUnitAuras("player")',
      'C_UnitAuras.GetUnitAuraInstanceIDs("player")',
      'C_UnitAuras.GetAuraSlots("player", "HELPFUL")',
      'C_UnitAuras.GetAuraDataByIndex("player", 1)',
      'C_UnitAuras.GetAuraDataBySlot("player", 1)',
      'C_UnitAuras.GetAuraDataByAuraInstanceID("player", 7)',
      'C_UnitAuras.GetBuffDataByIndex("player", 1)',
      'C_UnitAuras.GetDebuffDataByIndex("player", 1)',
      'C_UnitAuras.GetAuraDataBySpellName("player", "Rejuvenation")',
      'C_UnitAuras.GetUnitAuraBySpellID("player", 774)',
      'C_UnitAuras.GetPlayerAuraBySpellID(774)',
      'C_UnitAuras.GetCooldownAuraBySpellID(774)',
    ]) {
      expect(ids(`local a = ${call}\nlocal n = #a\n`)).toEqual(['WSL012@2']);
    }
  });

  it('permits string.format and concatenation on aura values', () => {
    const src =
      'local auras = C_UnitAuras.GetUnitAuras("player")\n' +
      'local s = string.format("%s", auras)\n' +
      'local c = "x" .. C_UnitAuras.GetUnitAuraInstanceIDs("player")\n';
    expect(ids(src)).toEqual([]);
  });

  it('clears aura taint inside a guard', () => {
    const src =
      'local auras = C_UnitAuras.GetUnitAuras("player")\n' +
      'if issecretvalue(auras) then return end\n' +
      'local n = #auras\n';
    expect(ids(src)).toEqual([]);
  });

  it('recognises the shipped guard idiom: index one field to test it, then treat the aura as readable', () => {
    // DBM-Core and BigWigs both do exactly this around every aura lookup.
    const src =
      'local aura = C_UnitAuras.GetPlayerAuraBySpellID(774)\n' +
      'if not aura or issecretvalue(aura.name) then return end\n' +
      'print(aura.icon, aura.expirationTime)\n';
    expect(ids(src)).toEqual([]);
    const method =
      'local aura = C_UnitAuras.GetPlayerAuraBySpellID(774)\n' +
      'if not aura or self:IsSecret(aura.name) then return end\n' +
      'print(aura.icon)\n';
    expect(ids(method)).toEqual([]);
  });

  it('still flags unguarded field reads on aura data', () => {
    expect(ids('local aura = C_UnitAuras.GetPlayerAuraBySpellID(774)\nprint(aura.icon)\n')).toEqual(['WSL012@2']);
  });

  it('keeps identity APIs quiet for the player unit but not for others', () => {
    expect(ids('local _, c = UnitClass("player")\nif c == "MAGE" then end\n')).toEqual([]);
    expect(ids('local _, c = UnitClass("arena1")\nif c == "MAGE" then end\n')).toEqual(['WSL013@2']);
    expect(ids('if UnitIsCharmed("pet") then end\n')).toEqual([]);
    expect(ids('if UnitIsCharmed(unit) then end\n')).toEqual(['WSL013@1']);
  });

  it('does not flag member access on documented aura structures under 12.0 rules', () => {
    // GetAuraDataByIndex returns AuraData; under 12.1 the whole return is a secret.
    expect(ids('local a = C_UnitAuras.GetAuraDataByIndex("player", 1)\nprint(a.name)\n')).toEqual(['WSL012@2']);
    expect(ids('local a = C_UnitAuras.GetAuraDataByIndex("player", 1)\nprint(a.name)\n', { patch: '12.0' })).toEqual([]);
  });

  it('honours --disable for the 12.1 rules', async () => {
    const findings = await lintFixture('wsl012-violating.lua', { disable: ['WSL012'] });
    expect(findings).toEqual([]);
  });
});

describe('the --patch flag', () => {
  const EXAMPLE = join('test', 'fixtures', 'worked-example-121', 'Core', 'Auras.lua');

  it('reproduces the 12.1 worked example: two WSL012 findings and exit 1', async () => {
    const r = await run([EXAMPLE]);
    const lines = r.stdout.trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^test\/fixtures\/worked-example-121\/Core\/Auras\.lua:1:63\s+error\s+WSL012\s+length operator/);
    expect(lines[0]).toContain("'auras' derives from C_UnitAuras.GetUnitAuras()");
    expect(lines[0]).toContain('AuraContainer (AddAuraGroup/AddAuraSlot)');
    expect(lines[1]).toMatch(/^test\/fixtures\/worked-example-121\/Core\/Auras\.lua:1:78\s+error\s+WSL012\s+indexed access/);
    expect(lines[2]).toBe('2 errors, 0 warnings');
    expect(r.code).toBe(1);
  });

  it('the worked example reports zero findings and exits 0 under --patch 12.0', async () => {
    const r = await run(['--patch=12.0', EXAMPLE]);
    expect(r.stdout.trim()).toBe('0 errors, 0 warnings');
    expect(r.code).toBe(0);
  });

  it('--patch 12.0 reproduces the pre-upgrade v1.2.0 output byte for byte', async () => {
    const baseline = await readFile(join(HERE, 'fixtures', 'patch', 'baseline-12.0.txt'), 'utf8');
    const r = await run(['--patch=12.0', 'test/fixtures/patch/input.lua']);
    expect(r.stdout).toBe(baseline);
    expect(r.code).toBe(0);
  });

  it('the same file fails under the default 12.1 surface', async () => {
    const r = await run(['test/fixtures/patch/input.lua']);
    expect(r.code).toBe(1);
    for (const id of ['WSL012', 'WSL013', 'WSL014', 'WSL015', 'WSL016', 'WSL017']) {
      expect(r.stdout).toContain(id);
    }
  });

  it('rejects an unknown patch value', async () => {
    const r = await run(['--patch=11.0', 'test/fixtures/clean']);
    expect(r.stderr).toMatch(/unknown --patch "11\.0" \(expected 12\.0 or 12\.1\)/);
    expect(r.code).toBe(2);
  });

  it('classic still exits 0 immediately, whatever the patch', async () => {
    const r = await run(['--game=classic', '--patch=12.1', 'test/fixtures/rules-121/wsl012-violating.lua']);
    expect(r.stdout.trim()).toBe('classic has no secret values; nothing to check');
    expect(r.code).toBe(0);
  });

  it('json output records the patch surface', async () => {
    const r = await run(['--format=json', '--patch=12.0', 'test/fixtures/clean']);
    expect(JSON.parse(r.stdout).patch).toBe('12.0');
  });
});
