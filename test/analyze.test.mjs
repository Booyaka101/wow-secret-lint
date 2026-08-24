import { describe, it, expect, beforeAll } from 'vitest';
import { analyzeSource } from '../src/analyze.mjs';
import { loadSnapshot } from '../src/apidata.mjs';
import { RULE_IDS } from '../src/rules.mjs';

let api;
beforeAll(async () => {
  api = await loadSnapshot();
});

function run(source, options) {
  return analyzeSource(source, 'x.lua', api, options);
}
function ids(source, options) {
  return run(source, options).findings.map((f) => `${f.ruleId}@${f.line}`);
}

describe('forbidden operations', () => {
  it('WSL001 arithmetic', () => {
    expect(ids('local hp = UnitHealth("t")\nlocal x = hp / 2\n')).toEqual(['WSL001@2']);
    expect(ids('local hp = UnitHealth("t")\nlocal x = -hp\n')).toEqual(['WSL001@2']);
  });

  it('WSL002 comparison and equality', () => {
    expect(ids('local hp = UnitHealth("t")\nif hp < 5 then end\n')).toEqual(['WSL002@2']);
    expect(ids('local hp = UnitHealth("t")\nif hp == 5 then end\n')).toEqual(['WSL002@2']);
    expect(ids('local hp = UnitHealth("t")\nif hp ~= 5 then end\n')).toEqual(['WSL002@2']);
  });

  it('WSL003 calling a secret value', () => {
    expect(ids('local d = UnitCastingDuration("t")\nd()\n')).toEqual(['WSL003@2']);
  });

  it('WSL004 length operator', () => {
    expect(ids('local n = UnitSpellTargetName("t")\nlocal l = #n\n')).toEqual(['WSL004@2']);
  });

  it('WSL005 indexed access, indexed assignment and secret keys', () => {
    expect(ids('local hp = UnitHealth("t")\nlocal v = hp.field\n')).toEqual(['WSL005@2']);
    expect(ids('local hp = UnitHealth("t")\nhp.field = 1\n')).toEqual(['WSL005@2']);
    expect(ids('local hp = UnitHealth("t")\nlocal t = {}\nlocal v = t[hp]\n')).toEqual(['WSL005@3']);
    expect(ids('local hp = UnitHealth("t")\nlocal t = { [hp] = 1 }\n')).toEqual(['WSL005@2']);
  });

  it('WSL006 secret passed to an API that does not allow it', () => {
    const notAllowed = ids('local hp = UnitHealth("t")\nC_CVar.SetCVar("x", hp)\n');
    expect(notAllowed).toEqual(['WSL006@2']);
    const whenUntainted = ids('local hp = UnitHealth("t")\nUnitHealthMax(hp)\n');
    expect(whenUntainted).toEqual(['WSL006@2']);
  });

  it('WSL006 never fires on the guard functions themselves', () => {
    expect(ids('local hp = UnitHealth("t")\nif issecretvalue(hp) then end\n')).toEqual([]);
    expect(ids('local hp = UnitHealth("t")\nlocal v = scrubsecretvalues(hp)\n')).toEqual([]);
  });

  it('WSL007 errors on a documented bool secret and stays silent on a documented non-bool', () => {
    const bool = run('local r = UnitInRange("t")\nif r then end\n').findings;
    expect(bool.map((f) => [f.ruleId, f.severity])).toEqual([['WSL007', 'error']]);
    expect(ids('local hp = UnitHealth("t")\nif hp then end\n')).toEqual([]);
    expect(ids('local n = UnitSpellTargetName("t")\nif n then end\n')).toEqual([]);
  });

  it('WSL008 combat log registration', () => {
    expect(ids('f:RegisterEvent("COMBAT_LOG_EVENT")\n')).toEqual(['WSL008@1']);
    expect(ids('f:RegisterEvent("COMBAT_LOG_EVENT_UNFILTERED")\n')).toEqual(['WSL008@1']);
    expect(ids('f:RegisterEvent("COMBAT_LOG_EVENT_INTERNAL_UNFILTERED")\n')).toEqual([]);
    expect(ids('f:RegisterEvent("PLAYER_LOGIN")\n')).toEqual([]);
  });

  it('WSL011 tostring on a secret', () => {
    const f = run('local hp = UnitHealth("t")\nlocal s = tostring(hp)\n').findings;
    expect(f.map((x) => [x.ruleId, x.severity])).toEqual([['WSL011', 'warning']]);
  });
});

describe('guards', () => {
  const body = 'local x = hp * 2\n';
  it('issecretvalue clears taint in the false branch', () => {
    expect(ids(`local hp = UnitHealth("t")\nif not issecretvalue(hp) then\n${body}end\n`)).toEqual([]);
    expect(ids(`local hp = UnitHealth("t")\nif issecretvalue(hp) then else\n${body}end\n`)).toEqual([]);
  });

  it('issecretvalue in the true branch does not clear taint', () => {
    expect(ids(`local hp = UnitHealth("t")\nif issecretvalue(hp) then\n${body}end\n`)).toEqual(['WSL001@3']);
  });

  it('canaccessvalue clears taint in the true branch', () => {
    expect(ids(`local hp = UnitHealth("t")\nif canaccessvalue(hp) then\n${body}end\n`)).toEqual([]);
  });

  it('canaccesstable and issecrettable clear the whole table', () => {
    const src = 'local i = C_LFGList.GetSearchResultInfo(1)\nif canaccesstable(i) then\nlocal a = i.activityIDs[1]\nend\n';
    expect(ids(src)).toEqual([]);
  });

  it('hasanysecretvalues clears in the false branch', () => {
    expect(ids(`local hp = UnitHealth("t")\nif not hasanysecretvalues(hp) then\n${body}end\n`)).toEqual([]);
  });

  it('an early return guards the rest of the block', () => {
    expect(ids(`local hp = UnitHealth("t")\nif issecretvalue(hp) then return end\n${body}`)).toEqual([]);
  });

  it('an and-chain guards every operand', () => {
    const src =
      'local a = UnitHealth("t")\nlocal b = UnitGetIncomingHeals("t")\nif not issecretvalue(a) and not issecretvalue(b) then\nlocal x = a + b\nend\n';
    expect(ids(src)).toEqual([]);
  });

  it('a guard short-circuits into the right-hand side of the same condition', () => {
    const src = 'local hp = UnitHealth("t")\nif canaccessvalue(hp) and hp > 0 then end\n';
    expect(ids(src)).toEqual([]);
  });

  it("a frame's HasSecretValues clears the receiver and its fields", () => {
    const src = 'local f = {}\nf.hp = UnitHealth("t")\nif not f:HasSecretValues() then\nlocal x = f.hp * 2\nend\n';
    expect(ids(src)).toEqual([]);
  });

  it('HasSecretAspect works the same way', () => {
    const src = 'local f = {}\nf.hp = UnitHealth("t")\nif f:HasSecretAspect() then else\nlocal x = f.hp * 2\nend\n';
    expect(ids(src)).toEqual([]);
  });

  it('recognises an addon-defined guard wrapper by name', () => {
    // KkthnxUI ships `IsSecret`, BigWigs ships `self:IsSecret`.
    const decl = 'local hp = UnitHealth("t")\n';
    expect(ids(`${decl}if not IsSecret(hp) then local x = hp * 2 end\n`)).toEqual([]);
    expect(ids(`${decl}if not self:IsSecret(hp) then local x = hp * 2 end\n`)).toEqual([]);
    expect(ids(`${decl}if CanAccessHealth(hp) then local x = hp * 2 end\n`)).toEqual([]);
  });

  it('accepts a custom guard name that does not match the heuristic', () => {
    const src = 'local hp = UnitHealth("t")\nif not Locked(hp) then local x = hp * 2 end\n';
    expect(ids(src)).toEqual(['WSL001@2']);
    expect(ids(src, { secretGuards: ['Locked'] })).toEqual([]);
  });

  it('scrubsecretvalues and secretwrap launder the value', () => {
    expect(ids('local hp = scrubsecretvalues(UnitHealth("t"))\nlocal x = hp * 2\n')).toEqual([]);
    expect(ids('local hp = secretwrap(UnitHealth("t"))\nlocal x = hp * 2\n')).toEqual([]);
  });

  it('a bare scrubsecretvalues call clears the rest of the block', () => {
    expect(ids('local hp = UnitHealth("t")\nscrubsecretvalues(hp)\nlocal x = hp * 2\n')).toEqual([]);
  });
});

describe('propagation', () => {
  it('follows plain assignment', () => {
    expect(ids('local hp = UnitHealth("t")\nlocal a = hp\nlocal b = a * 2\n')).toEqual(['WSL001@3']);
  });

  it('follows a table field store and read back', () => {
    expect(ids('local t = {}\nt.hp = UnitHealth("u")\nlocal x = t.hp + 1\n')).toEqual(['WSL001@3']);
  });

  it('follows the return value of a file-local function', () => {
    const src = 'local function GetHP(u) return UnitHealth(u) end\nlocal x = GetHP("t") * 2\n';
    expect(ids(src)).toEqual(['WSL001@2']);
  });

  it('follows one level of call-argument passing', () => {
    const src = 'local function Scale(v) return v * 2 end\nlocal hp = UnitHealth("t")\nScale(hp)\n';
    expect(ids(src)).toEqual(['WSL001@1']);
  });

  it('honours multi-return positions', () => {
    // C_CombatText.GetCurrentEventInfo is SecretReturns; UnitInRange returns two secrets.
    const src = 'local a, b = UnitInRange("t")\nlocal x = b + 1\n';
    expect(ids(src)).toEqual(['WSL001@2']);
  });

  it('does not taint a shadowed inner local', () => {
    const src = 'local hp = UnitHealth("t")\ndo\nlocal hp = 4\nlocal x = hp * 2\nend\n';
    expect(ids(src)).toEqual([]);
  });

  it('clears taint when a variable is reassigned from a plain value', () => {
    expect(ids('local hp = UnitHealth("t")\nhp = 3\nlocal x = hp * 2\n')).toEqual([]);
  });

  it('treats string.format output as not secret', () => {
    const src = 'local hp = UnitHealth("t")\nlocal s = string.format("%d", hp)\nlocal n = #s\n';
    expect(ids(src)).toEqual([]);
  });

  it('keeps taint through concatenation', () => {
    expect(ids('local hp = UnitHealth("t")\nlocal s = hp .. "x"\nlocal n = #s\n')).toEqual(['WSL004@3']);
  });
});

describe('conditional secrecy', () => {
  const src = 'local cd = C_Spell.GetSpellCooldown(1)\nif cd.startTime > 0 then end\n';

  it('is off by default, because it fires on ~1 line per file across real addons', () => {
    expect(run(src).findings).toEqual([]);
  });

  it('reports at warning severity when opted in', () => {
    const f = run(src, { conditional: 'warn' }).findings;
    expect(f.map((x) => [x.ruleId, x.severity])).toEqual([['WSL002', 'warning']]);
  });

  it('can be raised to error', () => {
    const f = run(src, { conditional: 'error' }).findings;
    expect(f.map((x) => [x.ruleId, x.severity])).toEqual([['WSL002', 'error']]);
  });

  it('can be switched off entirely', () => {
    expect(run(src, { conditional: 'off' }).findings).toEqual([]);
  });

  it('respects NeverSecret fields', () => {
    expect(ids('local cd = C_Spell.GetSpellCooldown(1)\nif cd.isEnabled then end\n')).toEqual([]);
  });

  it('WSL010 fires when nothing in scope guards a conditional value', () => {
    const src2 = 'local p = UnitPower("target")\nSomeExternalLib.Track(p)\n';
    const f = run(src2, { conditional: 'warn' }).findings;
    expect(f.map((x) => [x.ruleId, x.severity])).toEqual([['WSL010', 'warning']]);
  });

  it('WSL010 stays quiet once the file guards the value', () => {
    const src2 = 'local p = UnitPower("target")\nif canaccessvalue(p) then SomeExternalLib.Track(p) end\n';
    expect(ids(src2)).toEqual([]);
  });
});

describe('rule filtering and failure handling', () => {
  it('--disable silences a rule', () => {
    expect(ids('local hp = UnitHealth("t")\nlocal x = hp * 2\n', { disable: ['WSL001'] })).toEqual([]);
  });

  it('every rule id in the table is reachable from the fixtures or these tests', () => {
    expect(RULE_IDS).toHaveLength(11);
  });

  it('reports a parse error instead of throwing', () => {
    const { findings, parseError } = run('local x = UnitHealth("t"\nif x then\n');
    expect(findings).toEqual([]);
    expect(parseError).toMatchObject({ file: 'x.lua', line: 2 });
    expect(parseError.message).toMatch(/expected/);
  });

  it('handles an empty file', () => {
    expect(run('')).toEqual({ findings: [], parseError: null });
  });

  it('handles a file that is only comments', () => {
    expect(run('-- nothing here\n').findings).toEqual([]);
  });
});
