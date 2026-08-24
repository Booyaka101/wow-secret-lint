import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { extractFile, buildIndex, loadSnapshot, SNAPSHOT_PATH, isConditionalKey } from '../src/apidata.mjs';

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

  it('is valid JSON on disk', async () => {
    const raw = await readFile(SNAPSHOT_PATH, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('reports a clear error for a missing snapshot instead of throwing ENOENT', async () => {
    await expect(loadSnapshot('does/not/exist.json')).rejects.toThrow(/API snapshot missing/);
  });
});
