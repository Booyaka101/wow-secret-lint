// The 12.1.5 rule surface: WSL019-WSL021, --patch=auto, and the recorded baselines that
// prove --patch=12.0 and --patch=12.1 still produce v1.4.2's output byte for byte.

import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeSource } from '../src/analyze.mjs';
import { loadSnapshot } from '../src/apidata.mjs';
import { patchAtLeast, patchForInterface, patchList, DEFAULT_PATCH, PATCHES } from '../src/rules.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const BIN = join(ROOT, 'bin', 'wow-secret-lint.mjs');
const FIXTURES = join(HERE, 'fixtures', 'rules-1215');

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
  'wsl019-violating.lua': [
    'WSL019@7', // IsPlaying on the registered group
    'WSL019@8', // GetProgress
    'WSL019@9', // GetElapsed
    'WSL019@10', // IsPaused
    'WSL019@10', // IsDone, same line
    'WSL019@11', // IsDelaying on an animation inside the group
    'WSL019@12', // GetSmoothProgress
  ],
  'wsl020-violating.lua': [
    'WSL020@6', // CreateAnimation on the registered group
    'WSL020@9', // SetParent reparenting onto it
  ],
  'wsl021-violating.lua': [
    'WSL021@3', // _G lookup held in a local
    'WSL021@4', // the global written out
    'WSL021@5', // _G lookup called straight through
    'WSL021@9', // name built by concatenation
    'WSL021@11', // reached as the button's cooldown field
    'WSL021@12', // and its charge cooldown, through _G
    'WSL021@15', // a Cooldown the addon built from a secure template
  ],
};

describe('12.1.5 rule fixtures', () => {
  for (const [name, expected] of Object.entries(VIOLATING)) {
    it(`${name} produces exactly the documented findings`, async () => {
      const findings = await lintFixture(name);
      expect(findings.map((f) => `${f.ruleId}@${f.line}`)).toEqual(expected);
      expect(new Set(findings.map((f) => f.severity))).toEqual(new Set(['error']));
    });

    for (const patch of ['12.0', '12.1']) {
      it(`${name} is silent under --patch ${patch}`, async () => {
        expect(await lintFixture(name, { patch })).toEqual([]);
      });
    }

    it(`${name} is silenced by --disable`, async () => {
      const rule = expected[0].split('@')[0];
      expect(await lintFixture(name, { disable: [rule] })).toEqual([]);
    });

    const clean = name.replace('violating', 'clean');
    it(`${clean} reports nothing`, async () => {
      expect(await lintFixture(clean)).toEqual([]);
    });
  }

  it('names the forbidden aspect and the call in every animation message', async () => {
    const findings = [
      ...(await lintFixture('wsl019-violating.lua')),
      ...(await lintFixture('wsl020-violating.lua')),
    ];
    for (const f of findings) {
      expect(f.message).toMatch(f.ruleId === 'WSL019' ? /QueryAnimationProgress/ : /AddAnimations/);
      expect(f.message).toMatch(/forbidden aspect/);
    }
  });
});

describe('12.1.5 aspect tracking', () => {
  const REGISTER = ['AddPandemicEnterAnimation', 'AddPandemicActiveAnimation', 'AddPandemicLeaveAnimation'];

  it('every Pandemic trigger applies the aspects', () => {
    for (const method of REGISTER) {
      const src =
        'local b = CreateFrame("AuraButton", nil, UIParent)\n' +
        'local g = b:CreateAnimationGroup()\n' +
        `b:${method}(g)\n` +
        'if g:IsPlaying() then end\n';
      expect(ids(src)).toEqual(['WSL019@4']);
    }
  });

  it('leaves a group alone until it is registered', () => {
    const src =
      'local b = CreateFrame("AuraButton", nil, UIParent)\n' +
      'local g = b:CreateAnimationGroup()\n' +
      'if g:IsPlaying() then end\n' +
      'b:AddPandemicEnterAnimation(g)\n';
    expect(ids(src)).toEqual([]);
  });

  it('follows the value through a local alias several assignments away', () => {
    const src =
      'local b = CreateFrame("AuraButton", nil, UIParent)\n' +
      'local g = b:CreateAnimationGroup()\n' +
      'b:AddPandemicActiveAnimation(g)\n' +
      'local first = g\n' +
      'local second = first\n' +
      'local third = second\n' +
      'if third:IsPlaying() then end\n';
    expect(ids(src)).toEqual(['WSL019@7']);
  });

  it('keeps the aspects when the group is stored in a table field', () => {
    const src =
      'local b = CreateFrame("AuraButton", nil, UIParent)\n' +
      'local g = b:CreateAnimationGroup()\n' +
      'b:AddPandemicLeaveAnimation(g)\n' +
      'self.pandemic = g\n' +
      'local p = self.pandemic:GetProgress()\n';
    expect(ids(src)).toEqual(['WSL019@5']);
  });

  it('drops the aspects once the local is reassigned to something else', () => {
    const src =
      'local b = CreateFrame("AuraButton", nil, UIParent)\n' +
      'local g = b:CreateAnimationGroup()\n' +
      'b:AddPandemicEnterAnimation(g)\n' +
      'g = UIParent:CreateAnimationGroup()\n' +
      'if g:IsPlaying() then end\n';
    expect(ids(src)).toEqual([]);
  });

  it('does not flag the older aspects that animation methods also check', () => {
    // SetScript checks ScriptBindings and SetTarget checks ChangeAnimationTarget; both
    // predate 12.1.5 and neither is one of the two rules this release adds.
    const src =
      'local b = CreateFrame("AuraButton", nil, UIParent)\n' +
      'local g = b:CreateAnimationGroup()\n' +
      'local a = g:CreateAnimation("Alpha")\n' +
      'b:AddPandemicActiveAnimation(g)\n' +
      'g:SetScript("OnFinished", function() end)\n' +
      'a:SetTarget(UIParent)\n';
    expect(ids(src)).toEqual([]);
  });

  it('fires inside a guarded branch, because the call errors either way', () => {
    const src =
      'local b = CreateFrame("AuraButton", nil, UIParent)\n' +
      'local g = b:CreateAnimationGroup()\n' +
      'b:AddPandemicEnterAnimation(g)\n' +
      'if not IsSecret(g) then\n' +
      '  if g:IsPlaying() then end\n' +
      'end\n';
    expect(ids(src, { secretGuards: ['IsSecret'] })).toEqual(['WSL019@5']);
  });
});

describe('12.1.5 protected cooldowns', () => {
  it('flags every cooldown method the docs mark IsProtectedFunction', () => {
    for (const call of [
      'SetCooldown(0, 1)',
      'SetCooldownDuration(1)',
      'SetCooldownFromDurationObject(nil)',
      'SetCooldownFromExpirationTime(0, 1)',
      'SetCooldownUNIX(0, 1)',
      'Clear()',
    ]) {
      expect(ids(`ActionButton1Cooldown:${call}\n`)).toEqual(['WSL021@1']);
    }
  });

  it('leaves the unprotected cooldown methods alone', () => {
    for (const call of ['Pause()', 'Resume()', 'IsPaused()', 'SetDrawEdge(true)']) {
      expect(ids(`ActionButton1Cooldown:${call}\n`)).toEqual([]);
    }
  });

  it('recognises Blizzard action-bar cooldowns by name and nothing else', () => {
    for (const name of [
      'ActionButton1Cooldown',
      'StanceButton2Cooldown',
      'PetActionButton10Cooldown',
      'PossessButton1Cooldown',
      'MultiBarBottomRightButton7Cooldown',
      'MultiBar5Button1Cooldown',
    ]) {
      expect(ids(`${name}:Clear()\n`)).toEqual(['WSL021@1']);
    }
    for (const name of ['MyAddonButton1Cooldown', 'ActionButtonCooldown', 'CooldownFrame']) {
      expect(ids(`${name}:Clear()\n`)).toEqual([]);
    }
  });

  it('does not treat a cooldown on a frame the addon owns as protected', () => {
    const src =
      'local f = CreateFrame("Button", nil, UIParent)\n' +
      'local cd = CreateFrame("Cooldown", nil, f, "CooldownFrameTemplate")\n' +
      'cd:SetCooldown(0, 1)\n' +
      'f.cooldown = cd\n' +
      'f.cooldown:Clear()\n';
    expect(ids(src)).toEqual([]);
  });

  it('does not treat a cooldown under a secure button as protected, because protection runs upward', () => {
    // ScriptRegion:IsProtected: "Anchoring or parenting a protected frame to another frame
    // makes that frame implicitly protected as well." The child is not the one that changes.
    const src =
      'local f = CreateFrame("CheckButton", "MyBarButton1", UIParent, "SecureActionButtonTemplate")\n' +
      'local cd = CreateFrame("Cooldown", nil, f, "CooldownFrameTemplate")\n' +
      'cd:SetCooldown(0, 1)\n';
    expect(ids(src)).toEqual([]);
  });

  it('treats a Cooldown built from a secure template as protected at creation', () => {
    const src =
      'local cd = CreateFrame("Cooldown", nil, UIParent, "SecureFrameTemplate")\n' +
      'cd:SetCooldown(0, 1)\n';
    expect(ids(src)).toEqual(['WSL021@2']);
  });

  it('reaches a Blizzard action button cooldown through the button field', () => {
    expect(ids('ActionButton1.cooldown:Clear()\n')).toEqual(['WSL021@1']);
    expect(ids('_G["ActionButton1"].chargeCooldown:Clear()\n')).toEqual(['WSL021@1']);
    expect(ids('MyOwnButton1.cooldown:Clear()\n')).toEqual([]);
  });
});

describe('patch surface helpers', () => {
  it('orders the surfaces', () => {
    expect(PATCHES).toEqual(['12.0', '12.1', '12.1.5']);
    expect(DEFAULT_PATCH).toBe('12.1.5');
    expect(patchAtLeast('12.1.5', '12.1')).toBe(true);
    expect(patchAtLeast('12.1', '12.1.5')).toBe(false);
    expect(patchAtLeast('12.1', '12.1')).toBe(true);
    expect(patchAtLeast('12.0', '12.1')).toBe(false);
    expect(patchList()).toBe('12.0, 12.1 or 12.1.5');
  });

  it('maps a .toc Interface number onto a surface', () => {
    expect(patchForInterface(120105)).toBe('12.1.5');
    expect(patchForInterface(120200)).toBe('12.1.5');
    expect(patchForInterface(120104)).toBe('12.1');
    expect(patchForInterface(120100)).toBe('12.1');
    expect(patchForInterface(120007)).toBe('12.0');
  });
});

describe('the --patch flag at 12.1.5', () => {
  const ADDON = join('test', 'fixtures', 'worked-example-1215');

  it('reproduces the worked example: WSL019, WSL020, WSL021 and exit 1', async () => {
    const r = await run([ADDON]);
    const lines = r.stdout.trim().split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(
      /^test\/fixtures\/worked-example-1215\/Core\/Cooldowns\.lua:2:1\s+error\s+WSL021\s+cooldown:SetCooldown\(\)/
    );
    expect(lines[1]).toMatch(
      /^test\/fixtures\/worked-example-1215\/Core\/Pandemic\.lua:10:4\s+error\s+WSL019\s+querying the progress/
    );
    expect(lines[1]).toContain('QueryAnimationProgress forbidden aspect');
    expect(lines[2]).toMatch(
      /^test\/fixtures\/worked-example-1215\/Core\/Pandemic\.lua:11:1\s+error\s+WSL020\s+adding an animation/
    );
    expect(lines[2]).toContain('AddAnimations forbidden aspect');
    expect(lines[3]).toBe('3 errors, 0 warnings');
    expect(r.code).toBe(1);
  });

  it('reports nothing on the same addon under --patch=12.1', async () => {
    const r = await run(['--patch=12.1', ADDON]);
    expect(r.stdout.trim()).toBe('0 errors, 0 warnings');
    expect(r.code).toBe(0);
  });

  it('accepts auto and reads the surface off the addon .toc', async () => {
    const current = await run(['--patch=auto', '--format=json', ADDON]);
    expect(JSON.parse(current.stdout).patch).toBe('12.1.5');
    expect(current.code).toBe(1);

    const older = await run(['--patch=auto', '--format=json', join('test', 'fixtures', 'patch-auto-121')]);
    const parsed = JSON.parse(older.stdout);
    expect(parsed.patch).toBe('12.1');
    expect(parsed.findings).toEqual([]);
    expect(older.code).toBe(0);
  });

  it('says so when auto has no .toc to read', async () => {
    const r = await run(['--patch=auto', 'test/fixtures/rules-1215/wsl019-violating.lua']);
    expect(r.stdout).toMatch(/no \.toc Interface number to read, checking the 12\.1\.5 surface/);
  });

  it('rejects an unknown patch value and names auto', async () => {
    const r = await run(['--patch=12.2', 'test/fixtures/clean']);
    expect(r.stderr).toMatch(/unknown --patch "12\.2" \(expected 12\.0, 12\.1 or 12\.1\.5, or auto\)/);
    expect(r.code).toBe(2);
  });
});

describe('the 12.0 and 12.1 surfaces are unchanged from v1.4.2', () => {
  // Recorded by running v1.4.2 over the fixture corpus below, before any 12.1.5 work.
  async function targets() {
    const rules121 = (await readdir(join(HERE, 'fixtures', 'rules-121')))
      .filter((f) => f.endsWith('.lua'))
      .sort()
      .map((f) => `test/fixtures/rules-121/${f}`);
    const regressions = (await readdir(join(HERE, 'fixtures', 'regressions')))
      .sort()
      .map((d) => `test/fixtures/regressions/${d}/input.lua`);
    return [
      'test/fixtures/clean',
      'test/fixtures/rules/every-rule.lua',
      'test/fixtures/rules/hooksecurefunc.lua',
      'test/fixtures/rules/shadowing.lua',
      'test/fixtures/patch/input.lua',
      'test/fixtures/worked-example',
      'test/fixtures/worked-example-121/Core/Auras.lua',
      ...rules121,
      ...regressions,
    ];
  }

  for (const patch of ['12.0', '12.1']) {
    for (const [label, flags] of [
      ['default', []],
      ['strict', ['--strict', '--conditional=warn']],
    ]) {
      it(`--patch=${patch} ${label} matches the recorded baseline byte for byte`, async () => {
        const r = await run([`--patch=${patch}`, ...flags, ...(await targets())]);
        const baseline = await readFile(join(HERE, 'fixtures', 'patch', `baseline-${patch}-${label}.txt`), 'utf8');
        expect(`# exit ${r.code}\n${r.stdout}`).toBe(baseline);
      });
    }
  }
});
