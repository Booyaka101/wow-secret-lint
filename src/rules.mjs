// The rule table. Every entry maps 1:1 to a sentence Blizzard actually publishes.
// `source` records where the rule comes from so nothing here is folklore.

const WIKI = 'https://warcraft.wiki.gg/wiki/Secret_Values';
const PATCH = 'https://warcraft.wiki.gg/wiki/Patch_12.0.0/API_changes';

export const RULES = {
  WSL001: {
    severity: 'error',
    summary: 'arithmetic on a secret value',
    source: `${WIKI} : "Tainted code is not allowed to perform arithmetic on secret values."`,
  },
  WSL002: {
    severity: 'error',
    summary: 'comparison of a secret value',
    source: `${WIKI} : "Tainted code is not allowed to compare or perform boolean tests on secret values."`,
  },
  WSL003: {
    severity: 'error',
    summary: 'call of a secret value as-if it were a function',
    source: `${WIKI} : "Tainted code is not allowed to call secret values as-if they were functions."`,
  },
  WSL004: {
    severity: 'error',
    summary: 'length operator (#) on a secret value',
    source: `${WIKI} : "Tainted code is not allowed to use the length operator (#) on secret values."`,
  },
  WSL005: {
    severity: 'error',
    summary: 'indexed access, indexed assignment, or table key using a secret value',
    source: `${WIKI} : "Tainted code is not allowed to perform indexed access or assignment (secret["foo"] = 1) on secret values." / "...to store secret values as keys in tables."`,
  },
  WSL006: {
    severity: 'error',
    summary: 'secret value passed to an API whose SecretArguments does not allow it',
    source: 'Blizzard_APIDocumentationGenerated: SecretArguments = "NotAllowed" / "AllowedWhenUntainted"',
  },
  WSL007: {
    severity: 'error',
    summary: 'boolean test on a secret value',
    source: `${WIKI} : "Tainted code is not allowed to compare or perform boolean tests on secret values." Not reported when the documented return type is a non-boolean, because the same page states "Tainted code is allowed to perform boolean tests on non-boolean type secrets."`,
  },
  WSL008: {
    severity: 'error',
    summary: 'registering COMBAT_LOG_EVENT or COMBAT_LOG_EVENT_UNFILTERED',
    source: `${PATCH} : "COMBAT_LOG_EVENT and COMBAT_LOG_EVENT_UNFILTERED will error when trying to register them."`,
  },
  WSL009: {
    severity: 'warning',
    summary: 'secret value crosses a function boundary with no guard',
    source: 'Inferred. The callee never calls issecretvalue/canaccessvalue on the parameter, so any forbidden operation added there later errors at runtime.',
  },
  WSL010: {
    severity: 'warning',
    summary: 'conditionally secret value used with no guard anywhere in scope',
    source: 'Blizzard_APIDocumentationGenerated: SecretWhen*/SecretIn*/SecretReturnsForAspect. The value is secret only while that restriction is active, so this is a warning rather than an error.',
  },
  WSL011: {
    severity: 'warning',
    summary: 'tostring() on a secret value',
    source: `Inferred. tostring is absent from the allowed list on ${WIKI} and is not documented as forbidden either; kept a warning until confirmed in game.`,
  },
};

export const RULE_IDS = Object.keys(RULES);

/** Guard predicates: name -> which branch clears the taint, and whether it clears a whole table. */
export const GUARDS = {
  issecretvalue: { safeWhen: false, prefix: false },
  canaccessvalue: { safeWhen: true, prefix: false },
  issecrettable: { safeWhen: false, prefix: true },
  canaccesstable: { safeWhen: true, prefix: true },
  hasanysecretvalues: { safeWhen: false, prefix: true },
};

/** Frame/widget guard methods, called as obj:Method(). They clear the receiver and its fields. */
export const GUARD_METHODS = {
  HasSecretValues: { safeWhen: false },
  HasSecretAspect: { safeWhen: false },
  HasAnySecretAspect: { safeWhen: false },
};

/**
 * Addons almost always wrap the raw guards (KkthnxUI ships `IsSecret`, BigWigs ships
 * `self:IsSecret`). v1 does no cross-file analysis, so recognise the wrappers by name.
 * Returns the guard shape, or null when the name is not a guard.
 */
export function guardByName(name) {
  const bare = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name;
  if (Object.prototype.hasOwnProperty.call(GUARDS, bare)) return GUARDS[bare];
  if (Object.prototype.hasOwnProperty.call(GUARD_METHODS, bare)) {
    return { safeWhen: GUARD_METHODS[bare].safeWhen, prefix: true };
  }
  if (/^(is|has|hasany)_?secret/i.test(bare)) return { safeWhen: false, prefix: false };
  if (/^can_?access/i.test(bare)) return { safeWhen: true, prefix: false };
  return null;
}

/** Calls that launder a secret into something safe to use. */
export const SCRUBBERS = new Set(['scrubsecretvalues', 'secretwrap']);

/**
 * Calls the wiki explicitly blesses for secrets. Their results are not tracked as secret,
 * because the page names them as the sanctioned way to render a secret value.
 */
export const ALLOWED_SINKS = new Set([
  'string.concat',
  'string.format',
  'string.join',
  'format',
  'strjoin',
  'strconcat',
  'strformat',
]);

export const COMBAT_LOG_EVENTS = new Set(['COMBAT_LOG_EVENT', 'COMBAT_LOG_EVENT_UNFILTERED']);

export const COMBAT_LOG_REPLACEMENT =
  'use COMBAT_LOG_EVENT_INTERNAL_UNFILTERED or the C_CombatLog namespace instead';

/** Documented Lua types that can never be a boolean, so a boolean test on them is allowed. */
const NON_BOOL_TYPES = new Set([
  'number',
  'string',
  'cstring',
  'kstring',
  'luaIndex',
  'time_t',
  'fileID',
  'WOWGUID',
  'BigUInteger',
  'BigInteger',
  'uiUnit',
  'colorRGB',
  'colorRGBA',
  'textureAtlas',
  'textureKit',
]);

/**
 * Decide how a boolean test on a secret should be reported.
 * Returns 'error' when the documented type is bool, null when it is a documented non-bool
 * (the wiki allows it), and 'warning' when the type is unknown.
 */
export function booleanTestSeverity(type, structures = {}) {
  if (type === 'bool' || type === 'boolean') return 'error';
  if (!type) return 'warning';
  if (NON_BOOL_TYPES.has(type)) return null;
  if (type.startsWith('kstring') || type.startsWith('cstring')) return null;
  // A documented structure or table is never a boolean, so testing it is permitted.
  if (type === 'table' || Object.prototype.hasOwnProperty.call(structures, type)) return null;
  return 'warning';
}
