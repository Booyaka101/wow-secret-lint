import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { extractFile, buildIndex, loadSnapshot, SNAPSHOT_PATH, isConditionalKey, parseBuildMessage } from '../src/apidata.mjs';

// The exact UnitHealth entry as it appears in
// Interface/AddOns/Blizzard_APIDocumentationGenerated/UnitDocumentation.lua on the live branch.
const UNIT_DOC = `
local Unit =
{
	Name = "Unit",
	Type = "System",
	Namespace = nil,

	Functions =
	{
		{
			Name = "UnitHealth",
			Type = "Function",
			SecretReturns = true,
			SecretArguments = "AllowedWhenUntainted",

			Arguments =
			{
				{ Name = "unit", Type = "UnitTokenPvPRestrictedForAddOns", Nilable = false },
				{ Name = "usePredicted", Type = "bool", Nilable = false, Default = true },
			},

			Returns =
			{
				{ Name = "result", Type = "number", Nilable = false },
			},
		},
		{
			Name = "UnitHealthMax",
			Type = "Function",
			SecretWhenUnitHealthMaxRestricted = true,
			SecretArguments = "AllowedWhenUntainted",

			Returns =
			{
				{ Name = "result", Type = "number", Nilable = false },
			},
		},
	},

	Tables =
	{
		{
			Name = "SpellCooldownInfo",
			Type = "Structure",
			Fields =
			{
				{ Name = "startTime", Type = "number", Nilable = false },
				{ Name = "isEnabled", Type = "bool", Nilable = false, NeverSecret = true },
			},
		},
	},
};

APIDocumentation:AddDocumentationTable(Unit);
`;

describe('snapshot parser', () => {
  it('reads SecretReturns, SecretArguments, arguments and returns off the real entry shape', () => {
    const { functions } = extractFile(UNIT_DOC, 'UnitDocumentation.lua');
    const unitHealth = functions.find((f) => f.name === 'UnitHealth');
    expect(unitHealth).toBeDefined();
    expect(unitHealth.secretReturns).toBe(true);
    expect(unitHealth.secretArguments).toBe('AllowedWhenUntainted');
    expect(unitHealth.system).toBe('Unit');
    expect(unitHealth.args).toEqual([
      { name: 'unit', type: 'UnitTokenPvPRestrictedForAddOns', nilable: false },
      { name: 'usePredicted', type: 'bool', nilable: false },
    ]);
    expect(unitHealth.returns).toEqual([{ name: 'result', type: 'number', nilable: false }]);
  });

  it('records SecretWhen* markers as conditional rather than always-secret', () => {
    const { functions } = extractFile(UNIT_DOC, 'UnitDocumentation.lua');
    const max = functions.find((f) => f.name === 'UnitHealthMax');
    expect(max.secretReturns).toBe(false);
    expect(max.conditional).toEqual(['SecretWhenUnitHealthMaxRestricted']);
  });

  it('records NeverSecret markers on structure fields', () => {
    const { structures } = extractFile(UNIT_DOC, 'UnitDocumentation.lua');
    const cd = structures.find((s) => s.name === 'SpellCooldownInfo');
    expect(cd.annotated).toBe(true);
    expect(cd.fields.isEnabled.neverSecret).toBe(true);
    expect(cd.fields.startTime.neverSecret).toBeUndefined();
  });

  it('classifies conditional marker keys', () => {
    expect(isConditionalKey('SecretWhenCooldownsRestricted')).toBe(true);
    expect(isConditionalKey('SecretInChatMessagingLockdown')).toBe(true);
    expect(isConditionalKey('SecretReturnsForAspect')).toBe(true);
    expect(isConditionalKey('SecretReturns')).toBe(false);
    expect(isConditionalKey('SecretArguments')).toBe(false);
  });

  it('keys the index by bare name and by Namespace.Name', () => {
    const index = buildIndex([
      {
        functions: [
          {
            name: 'GetSpellCooldown',
            namespace: 'C_Spell',
            system: 'Spell',
            secretReturns: false,
            conditional: ['SecretWhenCooldownsRestricted'],
            secretArguments: 'AllowedWhenTainted',
            args: [],
            returns: [{ name: 'info', type: 'SpellCooldownInfo', nilable: false }],
          },
        ],
        structures: [],
      },
    ]);
    expect(index.functions['C_Spell.GetSpellCooldown']).toBeDefined();
    expect(index.functions.GetSpellCooldown.viaNamespace).toBe('C_Spell');
  });

  it('rejects Lua it cannot parse instead of returning a partial result', () => {
    expect(() => extractFile('local Unit = { Name = ', 'bad.lua')).toThrow(/could not parse bad\.lua/);
  });
});

// One aspect-checking and one protected method, exactly as they appear in
// SimpleAnimGroupAPIDocumentation.lua and FrameAPICooldownDocumentation.lua at 12.1.5.
const WIDGET_DOC = `
local SimpleAnimGroupAPI =
{
	Name = "SimpleAnimGroupAPI",
	Type = "ScriptObject",

	Functions =
	{
		{
			Name = "IsPlaying",
			Type = "Function",
			ChecksForbiddenAspects = { { Argument = "self", Aspect = Enum.ForbiddenAspect.QueryAnimationProgress } },

			Returns =
			{
				{ Name = "isPlaying", Type = "bool", Nilable = false },
			},
		},
		{
			Name = "SetParent",
			Type = "Function",
			ChecksForbiddenAspects = { { Argument = "parent", Aspect = Enum.ForbiddenAspect.AddAnimations } },

			Arguments =
			{
				{ Name = "parent", Type = "SimpleAnimGroup", Nilable = false },
				{ Name = "order", Type = "number", Nilable = true },
			},
		},
		{
			Name = "SetCooldown",
			Type = "Function",
			IsProtectedFunction = true,

			Arguments =
			{
				{ Name = "start", Type = "Seconds", Nilable = false },
			},
		},
	},
};

APIDocumentation:AddDocumentationTable(SimpleAnimGroupAPI);
`;

describe('12.1.5 widget markers', () => {
  it('reads ChecksForbiddenAspects and resolves the argument position', () => {
    const { functions } = extractFile(WIDGET_DOC, 'SimpleAnimGroupAPIDocumentation.lua');
    const playing = functions.find((f) => f.name === 'IsPlaying');
    expect(playing.aspects).toEqual([{ aspect: 'QueryAnimationProgress', argument: 'self' }]);
    const parent = functions.find((f) => f.name === 'SetParent');
    expect(parent.aspects).toEqual([{ aspect: 'AddAnimations', argument: 'parent', index: 0 }]);
  });

  it('reads IsProtectedFunction', () => {
    const { functions } = extractFile(WIDGET_DOC, 'SimpleAnimGroupAPIDocumentation.lua');
    expect(functions.find((f) => f.name === 'SetCooldown').protectedFunction).toBe(true);
    expect(functions.find((f) => f.name === 'IsPlaying').protectedFunction).toBe(false);
  });

  it('keys them by system, because method names collide across widget types', () => {
    const index = buildIndex([extractFile(WIDGET_DOC, 'SimpleAnimGroupAPIDocumentation.lua')]);
    expect(index.widgets.SimpleAnimGroupAPI.IsPlaying.aspects[0].aspect).toBe('QueryAnimationProgress');
    expect(index.widgets.SimpleAnimGroupAPI.SetCooldown.protected).toBe(true);
    expect(index.widgets.SimpleAnimGroupAPI.SetParent.protected).toBeUndefined();
  });

  it('reads the patch and build out of the mirror commit message', () => {
    expect(parseBuildMessage('12.1.5 (69594)')).toEqual({ patch: '12.1.5', build: 69594 });
    expect(parseBuildMessage('12.1.0 (69587)\n\nmore text')).toEqual({ patch: '12.1.0', build: 69587 });
    expect(parseBuildMessage('no build here')).toEqual({ patch: null, build: null });
    expect(parseBuildMessage(undefined)).toEqual({ patch: null, build: null });
  });
});

describe('vendored snapshot', () => {
  it('is real Blizzard data with UnitHealth.secretReturns === true', async () => {
    const api = await loadSnapshot();
    expect(api.functions.UnitHealth.secretReturns).toBe(true);
    expect(api.functions.UnitHealth.returns[0].type).toBe('number');
  });

  it('carries more than 5000 documented functions and at least one SecretReturns entry', async () => {
    const api = await loadSnapshot();
    expect(api.functionCount).toBeGreaterThan(5000);
    expect(api.secretReturnCount).toBeGreaterThanOrEqual(1);
    const secret = Object.entries(api.functions).filter(([, v]) => v.secretReturns);
    expect(secret.length).toBeGreaterThanOrEqual(1);
  });

  it('carries the conditional markers the regression fixtures depend on', async () => {
    const api = await loadSnapshot();
    expect(api.functions['C_Spell.GetSpellCooldown'].conditional).toContain('SecretWhenCooldownsRestricted');
    expect(api.functions['C_LFGList.GetSearchResultInfo'].conditional).toContain('SecretInChatMessagingLockdown');
    expect(api.structures.SpellCooldownInfo.fields.isEnabled.neverSecret).toBe(true);
    expect(api.structures.LfgSearchResultData.fields.activityIDs.neverSecret).toBeUndefined();
  });

  it('is the 12.1.5 documentation, with the markers the 12.1.5 rules read', async () => {
    const api = await loadSnapshot();
    expect(api.patch).toBe('12.1.5');
    expect(api.build).toBe(69594);
    expect(api.widgets.SimpleAnimGroupAPI.IsPlaying.aspects).toContainEqual({
      aspect: 'QueryAnimationProgress',
      argument: 'self',
    });
    expect(api.widgets.SimpleAnimAPI.SetParent.aspects).toContainEqual({
      aspect: 'AddAnimations',
      argument: 'parent',
      index: 0,
    });
    for (const name of ['Clear', 'SetCooldown', 'SetCooldownDuration', 'SetCooldownFromDurationObject', 'SetCooldownFromExpirationTime', 'SetCooldownUNIX']) {
      expect(api.widgets.FrameAPICooldown[name].protected).toBe(true);
    }
  });

  it('carries the globals patch 12.1.5 added', async () => {
    const api = await loadSnapshot();
    for (const name of ['math.clamp', 'math.lerp', 'math.round', 'string.contains', 'string.startswith', 'table.contains', 'table.keys', 'CreateFrameWithOptions']) {
      expect(api.functions[name], name).toBeDefined();
    }
    expect(api.functions['C_Weather.GetCurrentWeather']).toBeDefined();
    expect(Object.keys(api.functions).filter((k) => k.startsWith('C_Intl.')).length).toBeGreaterThan(20);
  });

  it('is valid JSON on disk', async () => {
    const raw = await readFile(SNAPSHOT_PATH, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('reports a clear error for a missing snapshot instead of throwing ENOENT', async () => {
    await expect(loadSnapshot('does/not/exist.json')).rejects.toThrow(/API snapshot missing/);
  });
});
