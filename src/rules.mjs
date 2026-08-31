// The rule table. Every entry maps 1:1 to a sentence Blizzard actually publishes.
// `source` records where the rule comes from so nothing here is folklore.

const WIKI = 'https://warcraft.wiki.gg/wiki/Secret_Values';
const PATCH = 'https://warcraft.wiki.gg/wiki/Patch_12.0.0/API_changes';
const PATCH121 = 'https://warcraft.wiki.gg/wiki/Patch_12.1.0/API_changes';

export const PATCHES = ['12.0', '12.1'];
export const DEFAULT_PATCH = '12.1';

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
  WSL012: {
    severity: 'error',
    patch: '12.1',
    summary: 'forbidden operation on a secret aura vector',
    source: `${PATCH121} : "when auras are secret (during combat, encounters, M+, and PvP matches), all of the UnitAura APIs will now either return full secrets or nil when called by addons. That means that APIs like GetUnitAuras and GetUnitAuraInstanceIDs will return a secret vector, meaning addon code will not be able to determine how many auras it contains or iterate through it for display."`,
  },
  WSL013: {
    severity: 'error',
    patch: '12.1',
    summary: 'forbidden operation on a secret unit identity value',
    source: `${PATCH121} : "A number of Unit APIs have been changed to return secret values when the unit's identity is secret", naming UnitClass, UnitClassBase, UnitRace, UnitSex and UnitSexBase; "UnitIsCharmed and UnitIsPossessed APIs now return secret values when auras are secret."`,
  },
  WSL014: {
    severity: 'error',
    patch: '12.1',
    summary: 'symbol removed or renamed in 12.1',
    source: `${PATCH121} : "UIParentLoadAddOn has been renamed to LoadAddOnWithErrorHandling." / "CanAccessObject has been replaced with FrameScriptObject:CanBeAccessedInContext." / "SecureAuraHeaderTemplate has been removed from Mainline"; C_UnitAuras.TriggerPrivateAuraShowDispelType is in the Removed list.`,
  },
  WSL015: {
    severity: 'warning',
    patch: '12.1',
    summary: 'deprecated getglobal/setglobal',
    source: `${PATCH121} : "Deprecated getglobal and setglobal."`,
  },
  WSL016: {
    severity: 'warning',
    patch: '12.1',
    summary: 'showCountdownFrame passed to a private-aura API',
    source: `${PATCH121} : showCountdownFrame was removed from AddPrivateAuraAnchorArgs and UnitPrivateAuraAnchorInfo, replaced by showCooldownFrame, showCooldownEdge and showDispelIcon. The field is silently ignored, so the cooldown swipe stops appearing with no Lua error. Note that AuraContainers now source private auras (AuraContainerPrivateAuraSource), which is the migration rather than the rename.`,
  },
  WSL017: {
    severity: 'error',
    patch: '12.1',
    summary: 'forbidden-aspect operation on an AuraButton or AuraContainer',
    source: `${PATCH121} : "Aura Buttons have had the following Forbidden Aspects applied to them: UntrustedScriptExecution, UntrustedLayoutScriptExecution, AlwaysPropagateInput, ScriptedInput, and QueryFocus" / "Aura Containers have had the EventRegistrations Forbidden Aspect applied to them."`,
  },
  WSL018: {
    severity: 'error',
    patch: '12.1',
    summary: 'call of an aura API that errors while auras are secret',
    source: `${PATCH121} : "C_UnitAura and C_TooltipInfo APIs that provide access to aura data via index, slot, or instance ID will Lua error when called by addons while auras are secret."`,
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

// ------------------------------------------------------------- patch 12.1 surface
//
// None of this is in Blizzard's generated documentation. Aura secrecy is behavioural
// ("when auras are secret ... return full secrets or nil"), documented only in the 12.1
// patch notes, so the snapshot cannot carry it and these lists seed the taint instead.

/**
 * APIs whose returns are a secret aura vector or secret aura data in 12.1. Taints they
 * produce carry category 'aura' and report as WSL012. Bare names are listed too because
 * the snapshot registers global aliases for namespaced functions.
 */
export const AURA_SECRET_APIS = new Set(
  [
    'C_UnitAuras.GetUnitAuras',
    'C_UnitAuras.GetUnitAuraInstanceIDs',
    'C_UnitAuras.GetAuraSlots',
    'C_UnitAuras.GetAuraDataByIndex',
    'C_UnitAuras.GetAuraDataBySlot',
    'C_UnitAuras.GetAuraDataByAuraInstanceID',
    'C_UnitAuras.GetBuffDataByIndex',
    'C_UnitAuras.GetDebuffDataByIndex',
    // "all of the UnitAura APIs" per the 12.1 notes, so the by-spell lookups too.
    'C_UnitAuras.GetAuraDataBySpellName',
    'C_UnitAuras.GetUnitAuraBySpellID',
    'C_UnitAuras.GetPlayerAuraBySpellID',
    'C_UnitAuras.GetCooldownAuraBySpellID',
  ].flatMap((n) => [n, n.slice(n.indexOf('.') + 1)])
);

/**
 * Unit APIs the 12.1 notes name as returning secrets. Category 'identity', rule WSL013.
 * This is the notes' full list, every one of which also carries
 * SecretWhenUnitIdentityRestricted in the generated docs. GetInspectSpecialization is in
 * that list too but the global was removed in the same patch, so it lives in REMOVED_CALLS.
 */
export const IDENTITY_SECRET_APIS = new Set([
  'UnitClass',
  'UnitClassBase',
  'UnitRace',
  'UnitSex',
  'UnitSexBase',
  'UnitIsCharmed',
  'UnitIsPossessed',
  'UnitIsOwnerOrControllerOfUnit',
  'UnitPhaseReason',
  'UnitGroupRolesAssigned',
  'UnitGroupRolesAssignedEnum',
  'UnitIsRaidOfficer',
  'UnitInRaid',
  'UnitIsPVP',
  'UnitIsGroupLeader',
  'UnitIsGroupAssistant',
  'UnitLeadsAnyGroup',
  'UnitGetAvailableRoles',
]);

/**
 * Aura APIs reached by index, slot or instance id. The 12.1 notes say the call itself
 * errors while auras are secret, so the call site is reported (WSL018) on top of any
 * misuse of what it returns.
 */
export const AURA_ERRORING_CALLS = new Set(
  [
    'C_UnitAuras.GetAuraDataByIndex',
    'C_UnitAuras.GetAuraDataBySlot',
    'C_UnitAuras.GetAuraDataByAuraInstanceID',
    'C_UnitAuras.GetBuffDataByIndex',
    'C_UnitAuras.GetDebuffDataByIndex',
    'C_UnitAuras.GetAuraSlots',
    'C_UnitAuras.IsAuraFilteredOutByInstanceID',
    'C_TooltipInfo.GetUnitAura',
    'C_TooltipInfo.GetUnitBuff',
    'C_TooltipInfo.GetUnitDebuff',
    'C_TooltipInfo.GetUnitBuffByAuraInstanceID',
    'C_TooltipInfo.GetUnitDebuffByAuraInstanceID',
  ].flatMap((n) => [n, n.slice(n.indexOf('.') + 1)])
);

/**
 * Literal unit tokens that keep identity APIs non-secret. The 12.1 notes state it for
 * UnitIsCharmed/UnitIsPossessed ("no longer return secret values if the unit token passed
 * is 'player', 'pet', or 'vehicle'"); for the rest only "player" is exempted, because the
 * change exists to stop addons comparing secret units and a unit is never secret to itself.
 */
export const SELF_EXEMPT_TOKENS = new Set(['player', 'pet', 'vehicle']);
export const AURA_STATE_IDENTITY_APIS = new Set(['UnitIsCharmed', 'UnitIsPossessed']);

/** Operator findings on a categorised taint report as the 12.1 rule instead. */
export const CATEGORY_RULES = { aura: 'WSL012', identity: 'WSL013' };

/** Iterating a secret vector cannot work; flagged for categorised taints only. */
export const ITERATORS = new Set(['pairs', 'ipairs', 'next', 'unpack']);

export const AURA_SUGGESTION =
  'show auras with an AuraContainer (AddAuraGroup/AddAuraSlot) instead';

/**
 * Calls removed, renamed or deprecated in 12.1. The removals are the 19 entries of the
 * Removed column of the patch's global function table; the count in that table header is
 * what pins the list. A replacement is named only where the notes state the rename, or
 * where the bare global moved into a namespace under the same name and the target is
 * present in the generated docs. The rest say only that the symbol is gone, because
 * inventing a replacement is worse than admitting there is none.
 */
function removal(name, replacement) {
  return {
    ruleId: 'WSL014',
    message: replacement
      ? `${name}() was removed or renamed in 12.1; use ${replacement}() instead`
      : `${name}() was removed in 12.1 and no replacement is documented; calling it errors on a nil value`,
  };
}

export const REMOVED_CALLS = {
  UIParentLoadAddOn: {
    ruleId: 'WSL014',
    message: 'UIParentLoadAddOn() was renamed in 12.1; call LoadAddOnWithErrorHandling() instead',
  },
  CanAccessObject: {
    ruleId: 'WSL014',
    message: 'CanAccessObject() was removed in 12.1; use FrameScriptObject:CanBeAccessedInContext() instead',
  },
  'C_UnitAuras.TriggerPrivateAuraShowDispelType': {
    ruleId: 'WSL014',
    message:
      'C_UnitAuras.TriggerPrivateAuraShowDispelType() was removed in 12.1; use the showDispelIcon option on private aura anchors instead',
  },

  // Renames the notes state outright.
  'C_UnitAuras.AddPrivateAuraAppliedSound': removal(
    'C_UnitAuras.AddPrivateAuraAppliedSound',
    'C_UnitAuras.AddAuraSound'
  ),
  'C_UnitAuras.RemovePrivateAuraAppliedSound': removal(
    'C_UnitAuras.RemovePrivateAuraAppliedSound',
    'C_UnitAuras.RemoveAuraSound'
  ),

  // Bare globals that moved into a namespace under the same name.
  CanSurrenderArena: removal('CanSurrenderArena', 'C_PvP.CanSurrenderArena'),
  GetInspectSpecialization: removal('GetInspectSpecialization', 'C_SpecializationInfo.GetInspectSpecialization'),
  GetInventorySlotInfo: removal('GetInventorySlotInfo', 'C_PaperDollInfo.GetInventorySlotInfo'),
  'C_SuperTrack.GetNextWaypointForMap': removal(
    'C_SuperTrack.GetNextWaypointForMap',
    'C_Navigation.GetNextWaypointForMap'
  ),

  // Removed with no replacement this project can verify.
  BNGetFriendInviteInfo: removal('BNGetFriendInviteInfo'),
  BNSendVerifiedBattleTagInvite: removal('BNSendVerifiedBattleTagInvite'),
  CancelItemTempEnchantment: removal('CancelItemTempEnchantment'),
  GetWeaponEnchantInfo: removal('GetWeaponEnchantInfo'),
  SetTableSecurityOption: removal('SetTableSecurityOption'),
  'C_DyeColor.GetDyeColorForItem': removal('C_DyeColor.GetDyeColorForItem'),
  'C_DyeColor.GetDyeColorForItemLocation': removal('C_DyeColor.GetDyeColorForItemLocation'),
  'C_Housing.IsInsideOwnHouse': removal('C_Housing.IsInsideOwnHouse'),
  'C_HousingLayout.GetNumFloors': removal('C_HousingLayout.GetNumFloors'),
  'C_Ping.GetContextualPingTypeForUnit': removal('C_Ping.GetContextualPingTypeForUnit'),
  'C_PvP.JoinRandomTrainingGround': removal('C_PvP.JoinRandomTrainingGround'),
  'C_RecruitAFriend.IsEnabled': removal('C_RecruitAFriend.IsEnabled'),

  getglobal: {
    ruleId: 'WSL015',
    message: 'getglobal() is deprecated in 12.1; use _G[name] instead',
  },
  setglobal: {
    ruleId: 'WSL015',
    message: 'setglobal() is deprecated in 12.1; use _G[name] = value instead',
  },
};

export const REMOVED_TEMPLATE = 'SecureAuraHeaderTemplate';
export const REMOVED_TEMPLATE_MESSAGE =
  'SecureAuraHeaderTemplate was removed from Mainline in 12.1; migrate to an AuraContainer (AddAuraGroup/AddAuraSlot)';

/** Structure fields renamed in 12.1 whose old name is silently ignored at runtime. */
export const RENAMED_STRUCT_FIELDS = {
  showCountdownFrame: 'showCooldownFrame',
};

/** CreateFrame frame types that carry Forbidden Aspects from creation. */
export const ASPECT_FRAME_TYPES = new Set(['AuraContainer', 'AuraButton']);

/** Container methods whose options table hands AuraButtons to an initializeFrame callback. */
export const AURA_GROUP_METHODS = new Set(['AddAuraGroup', 'AddAuraSlot', 'AddItemEnchantment']);

/**
 * Methods disallowed by the Forbidden Aspects each frame type carries. Buttons additionally
 * get event registration flagged: they join the container's forbidden partition and the 12.1
 * announcement says addons cannot "register events on those buttons".
 */
const BUTTON_SCRIPTS = { aspect: 'UntrustedScriptExecution', verb: 'installing a script handler' };
const EVENT_REG = { aspect: 'EventRegistrations', verb: 'registering for events' };
const INPUT_CALL = { aspect: 'ScriptedInput', verb: 'calling an input API' };
const FOCUS_QUERY = { aspect: 'QueryFocus', verb: 'querying focus' };

export const FORBIDDEN_ASPECT_METHODS = {
  AuraButton: {
    SetScript: BUTTON_SCRIPTS,
    HookScript: BUTTON_SCRIPTS,
    RegisterEvent: EVENT_REG,
    RegisterUnitEvent: EVENT_REG,
    RegisterAllEvents: EVENT_REG,
    Click: INPUT_CALL,
    SetFocus: INPUT_CALL,
    EnableMouse: INPUT_CALL,
    EnableKeyboard: INPUT_CALL,
    EnableMouseWheel: INPUT_CALL,
    EnableGamePadButton: INPUT_CALL,
    EnableGamePadStick: INPUT_CALL,
    SetPropagateKeyboardInput: INPUT_CALL,
    SetPassThroughButtons: INPUT_CALL,
    RegisterForClicks: INPUT_CALL,
    RegisterForDrag: INPUT_CALL,
    IsMouseOver: FOCUS_QUERY,
    IsMouseMotionFocus: FOCUS_QUERY,
    HasFocus: FOCUS_QUERY,
  },
  AuraContainer: {
    RegisterEvent: EVENT_REG,
    RegisterUnitEvent: EVENT_REG,
    RegisterAllEvents: EVENT_REG,
  },
};

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
