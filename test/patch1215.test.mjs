// The 12.1.5 rule surface: WSL019-WSL021, --patch=auto, and the recorded baselines that
// prove --patch=12.0 and --patch=12.1 still produce v1.4.2's output byte for byte.

import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeSource } from '../src/analyze.mjs';
import { loadSnapshot } from '../src/apidata.mjs';
import { patchAtLeast, patchForInterface, patchList, refusedTransliterator, DEFAULT_PATCH, PATCHES, RULES } from '../src/rules.mjs';

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
  'wsl022-violating.lua': [
    'WSL022@4', // Any-Null
    'WSL022@5', // Remove inside a compound ID, behind a [set] filter
    'WSL022@6', // Remove behind a nested [set] filter
    'WSL022@9', // the ID held in a local constant
    'WSL022@10', // Null with a variant, second in the chain
  ],
};

describe('12.1.5 rule fixtures', () => {
  for (const [name, expected] of Object.entries(VIOLATING)) {
    it(`${name} produces exactly the documented findings`, async () => {
      const findings = await lintFixture(name);
      expect(findings.map((f) => `${f.ruleId}@${f.line}`)).toEqual(expected);
      const rule = expected[0].split('@')[0];
      expect(new Set(findings.map((f) => f.severity))).toEqual(new Set([RULES[rule].severity]));
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

describe('WSL022, C_Intl.Transliterate', () => {
  it('quotes the precondition and its failure mode', async () => {
    const [first] = await lintFixture('wsl022-violating.lua');
    expect(first.severity).toBe('warning');
    expect(first.message).toContain("refuses the Null transliterator ('Any-Null')");
    expect(first.message).toContain('TransliteratorAllowed, FailureMode ReturnNothing');
    expect(first.column).toBe(42);
  });

  it('stays a warning under --strict, because the call returns nothing rather than erroring', async () => {
    const findings = await lintFixture('wsl022-violating.lua', { strict: true });
    expect(new Set(findings.map((f) => f.severity))).toEqual(new Set(['warning']));
  });

  it('reads Null and Remove out of any shape of ICU ID', () => {
    expect(refusedTransliterator('Any-Null')).toBe('Null');
    expect(refusedTransliterator('any-remove')).toBe('Remove');
    expect(refusedTransliterator('Null')).toBe('Null');
    expect(refusedTransliterator('[:Mn:] Remove')).toBe('Remove');
    expect(refusedTransliterator('[[:Mn:][:Me:]] Remove')).toBe('Remove');
    expect(refusedTransliterator('[\\]] Remove')).toBe('Remove');
    expect(refusedTransliterator('NFD; [:Nonspacing Mark:] Remove; NFC')).toBe('Remove');
    expect(refusedTransliterator('Latin-ASCII; Any-Null/Variant')).toBe('Null');
    expect(refusedTransliterator('Any-Remove (Any-Latin)')).toBe('Remove');
    expect(refusedTransliterator('[;] Remove')).toBe('Remove');
    expect(refusedTransliterator('[[:Mn:];-] Remove; NFC')).toBe('Remove');
    expect(refusedTransliterator('NFD; \\p{Mn} Remove; NFC')).toBe('Remove');
    expect(refusedTransliterator("[']'] Remove")).toBe('Remove');
  });

  it('lets every other ID through, including ones that merely mention the words', () => {
    expect(refusedTransliterator('Any-Latin')).toBeNull();
    expect(refusedTransliterator('NFD; Latin-ASCII; NFC')).toBeNull();
    expect(refusedTransliterator('Any-Latin (Any-Remove)')).toBeNull();
    expect(refusedTransliterator('[:Remove:] Any-Latin')).toBeNull();
    expect(refusedTransliterator('Null-Latin')).toBeNull();
    expect(refusedTransliterator('Any-Latin; [;-Null]')).toBeNull();
    expect(refusedTransliterator('\\p{Script=Null-Remove} Any-Latin')).toBeNull();
    expect(refusedTransliterator('')).toBeNull();
  });

  it('is silent when the ID is not a literal', () => {
    expect(ids("local n = UnitSpellTargetName('target')\nC_Intl.Transliterate(n, GetID())\n")).toEqual([]);
  });

  it('reads a constant only where it is in scope', () => {
    const param = [
      "local function setup() local ID = 'Any-Remove' return ID end",
      "local function strip(ID) return C_Intl.Transliterate(UnitSpellTargetName('target'), ID) end",
    ];
    expect(ids(param.join('\n') + '\n')).toEqual([]);
    const upvalue = [
      "local ID = 'Any-Remove'",
      'local function g() local ID = GetID() end',
      "local function h() return C_Intl.Transliterate(UnitSpellTargetName('target'), ID) end",
    ];
    expect(ids(upvalue.join('\n') + '\n')).toEqual(['WSL022@3']);
  });
});

describe('C_Intl at 12.1.5 build 69952', () => {
  const ADDON = join('test', 'fixtures', 'worked-example-intl');

  it('reproduces the README worked example byte for byte', async () => {
    const r = await run(['--strict', 'Adopter.lua'], join(ROOT, ADDON));
    expect(r.stdout).toBe(
      [
        "Adopter.lua:2:24  error  WSL006  secret value passed to math.clamp(), which is documented SecretArguments = \"AllowedWhenUntainted\" and addon code is always tainted: 'hp' derives from UnitHealth() (SecretReturns=true)",
        'Adopter.lua:4:22  error  WSL006  secret value passed to string.startswith(), which is documented SecretArguments = "AllowedWhenUntainted" and addon code is always tainted: derives from UnitSpellTargetName() (SecretReturns=true)',
        '2 errors, 0 warnings',
        '',
      ].join('\n')
    );
    expect(r.code).toBe(1);
  });

  it('no longer flags C_Intl.ToUpper, and still flags C_Intl.CreateLocaleContext', async () => {
    const source = await readFile(join(ROOT, ADDON, 'Locale.lua'), 'utf8');
    const { findings } = analyzeSource(source, 'Locale.lua', api, { strict: true });
    expect(findings.map((f) => `${f.ruleId}@${f.line}`)).toEqual(['WSL006@3']);
    expect(findings[0].message).toContain('C_Intl.CreateLocaleContext()');
  });

  it('picks the 12.1.5 surface with --patch=auto on its 120105 .toc', async () => {
    const r = await run(['--strict', '--patch=auto', '--format=json', ADDON]);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.patch).toBe('12.1.5');
    expect(parsed.findings.map((f) => `${f.file.split('/').pop()}:${f.line}`)).toEqual([
      'Adopter.lua:2',
      'Adopter.lua:4',
      'Locale.lua:3',
    ]);
    expect(r.code).toBe(1);
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

  it('resolves the loop every action-bar addon writes, and only for Blizzard names', () => {
    const loop = (body) => `for i = 1, 12 do\n  ${body}\nend\n`;
    expect(ids(loop('_G["ActionButton" .. i .. "Cooldown"]:SetCooldown(0, 1)'))).toEqual(['WSL021@2']);
    expect(ids(loop('local b = _G["MultiBar5Button" .. i]\n  b.cooldown:Clear()'))).toEqual(['WSL021@3']);
    expect(ids(loop('local n = "PetActionButton" .. i .. "Cooldown"\n  _G[n]:SetCooldownDuration(1)'))).toEqual(['WSL021@3']);
    expect(ids(loop('_G["MyBarButton" .. i .. "Cooldown"]:SetCooldown(0, 1)'))).toEqual([]);
  });

  it('does not mistake a local or parameter that shares a Blizzard name for the frame', () => {
    expect(ids('local function Skin(ActionButton1Cooldown)\n  ActionButton1Cooldown:Clear()\nend\n')).toEqual([]);
    expect(ids('local ActionButton1 = {}\nActionButton1.cooldown:Clear()\n')).toEqual([]);
    expect(ids('ActionButton1Cooldown:Clear()\n')).toEqual(['WSL021@1']);
  });

  it('reaches a Blizzard action button cooldown through the button field', () => {
    expect(ids('ActionButton1.cooldown:Clear()\n')).toEqual(['WSL021@1']);
    expect(ids('_G["ActionButton1"].chargeCooldown:Clear()\n')).toEqual(['WSL021@1']);
    expect(ids('MyOwnButton1.cooldown:Clear()\n')).toEqual([]);
  });
});

describe('12.1.5 cooldown hooks', () => {
  const HOOK = 'local mt = getmetatable(ActionButton1Cooldown).__index\n';

  it('treats the first parameter of a metatable-hooked handler as a cooldown that may be protected', () => {
    const named =
      'local Cooldown = {}\n' +
      'function Cooldown:OnSetCooldown(start, duration)\n' +
      '  self:SetCooldown(start, duration)\n' +
      'end\n' +
      HOOK +
      'hooksecurefunc(mt, "SetCooldown", Cooldown.OnSetCooldown)\n';
    expect(ids(named)).toEqual(['WSL021@3']);
    const inline = HOOK + 'hooksecurefunc(mt, "Clear", function(cd) cd:Clear() end)\n';
    expect(ids(inline)).toEqual(['WSL021@2']);
    const local = 'local function onDuration(cd, d) cd:SetCooldownDuration(d) end\n' + HOOK + 'hooksecurefunc(mt, "SetCooldownDuration", onDuration)\n';
    expect(ids(local)).toEqual(['WSL021@1']);
  });

  it('follows getmetatable through an addon-created Cooldown and a protected frame hooked directly', () => {
    const own = 'local mine = CreateFrame("Cooldown")\nhooksecurefunc(getmetatable(mine).__index, "SetCooldown", function(cd) cd:SetCooldown(0, 1) end)\n';
    expect(ids(own)).toEqual(['WSL021@2']);
    const direct = 'hooksecurefunc(ActionButton2Cooldown, "SetCooldownUNIX", function(self) self:SetCooldownUNIX(0, 0) end)\n';
    expect(ids(direct)).toEqual(['WSL021@1']);
  });

  it('is silent when the handler checks IsProtected, reads only, or hooks something else', () => {
    const guarded = HOOK + 'hooksecurefunc(mt, "Clear", function(cd) if cd:IsProtected() then return end cd:Clear() end)\n';
    expect(ids(guarded)).toEqual([]);
    const notGuard = HOOK + 'hooksecurefunc(mt, "Clear", function(cd) if cd:IsForbidden() then return end cd:Clear() end)\n';
    expect(ids(notGuard)).toEqual(['WSL021@2']);
    const reads = HOOK + 'hooksecurefunc(mt, "SetCooldown", function(cd) cd:Pause() print(cd:GetCooldownTimes()) end)\n';
    expect(ids(reads)).toEqual([]);
    const unrelated = 'local t = {}\nhooksecurefunc(t, "SetCooldown", function(self) self:SetCooldown(0, 1) end)\n';
    expect(ids(unrelated)).toEqual([]);
    const byName = 'hooksecurefunc("CooldownFrame_Set", function(cd) cd:SetCooldown(0, 1) end)\n';
    expect(ids(byName)).toEqual([]);
  });

  it('does not let IsProtected clear taint, only the protected-call check', () => {
    const src = 'local hp = UnitHealth("t")\nif not f:IsProtected() then local x = hp * 2 end\n';
    expect(ids(src)).toEqual(['WSL001@2']);
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
    expect(patchForInterface(16001)).toBe('12.1.5');
    expect(patchForInterface(19999)).toBe('12.1.5');
    expect(patchForInterface(20000)).toBe('12.0');
    expect(patchForInterface(11507)).toBe('12.0');
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
