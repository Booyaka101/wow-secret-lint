# wow-secret-lint

Static analysis for World of Warcraft **retail** addons. It maps where your Lua touches Blizzard's secret-value API, and hard-fails your build on the things Blizzard documents as certain to break.

Patch 12.0 introduced [secret values](https://warcraft.wiki.gg/wiki/Secret_Values). A lot of the API now hands your addon a value you are allowed to store, pass around and print, but not to do arithmetic on, compare, index, call, or measure with `#`. Patch 12.1 (Curse of Ula'tek, live 2026-08-11) [widened that surface enormously](https://warcraft.wiki.gg/wiki/Patch_12.1.0/API_changes): every `UnitAura` API returns full secrets or nil while auras are secret, seventeen unit identity APIs joined them, and the new AuraButton/AuraContainer frames carry forbidden aspects. When tainted code does something disallowed, the wiki is blunt about the result:

> When an operation that is not allowed is performed, the result will be an **immediate** Lua error.

The failure is invisible until it happens at runtime, in someone else's game, in a stack trace that points at a Blizzard file:

```
...UIWidgets/Blizzard_UIWidgetTemplateTextWithState.lua:35: attempt to perform arithmetic
on local 'textHeight' (a secret number value, while execution tainted by 'KkthnxUI')
```

That one is [KkthnxUI#121](https://github.com/Kkthnx-Wow/KkthnxUI/issues/121), filed 2026-08-23. The identical trace was filed the same week against a completely unrelated addon, [aura-questor#68](https://github.com/lucascodev/aura-questor/issues/68). Both are in this repo's regression corpus.

`wow-secret-lint` reads Blizzard's own generated API documentation, tracks which of your locals hold a secret, and tells you where you touch one.

**It reports, it does not accuse.** The rules that fail your build by default are the ones Blizzard states outright: `WSL008` (combat log registration errors), and the 12.1 rules `WSL012`/`WSL013` (aura and identity APIs "will now either return full secrets or nil when called by addons"), `WSL014` (the symbol no longer exists) and `WSL017` (forbidden aspects). The 12.0-era `SecretReturns` tier stays a warning, because whether those APIs really hand a secret to tainted code on every call is not something static analysis can confirm; run `--strict` to gate on it. [The reasoning is spelled out below](#the-open-question-on-severity) and it is worth two minutes before you wire this into CI.

## Install

```bash
npm install --save-dev wow-secret-lint
# or run it once
npx wow-secret-lint ./MyAddon
```

Node 20 or newer. No network access during a lint run: the API snapshot is vendored in the package.

## Usage

Point it at an addon folder and it reads the `.toc` files to decide which Lua to analyse, in load order, following `<Script>` and `<Include>` entries in any listed `.xml`.

Discovery is flavour-aware. If the folder has no `.toc` it descends up to three levels to find one, which is how most repos are laid out. A `.toc` counts as retail when any of its `## Interface` ids is a retail one; a folder whose every `.toc` targets Classic is skipped with a message rather than scanned. Only when there is no `.toc` anywhere does it fall back to walking every `.lua`, and it says so when it does.

```bash
npx wow-secret-lint ./MyAddon
```

`Core/UnitFrame.lua`:

```lua
local hp = UnitHealth("target")
local max = UnitHealthMax("target")
local pct = hp / max * 100
if hp < max then frame:Show() end
frame.text:SetText(string.format("%s hp", hp))
```

```
$ npx wow-secret-lint Core/UnitFrame.lua
Core/UnitFrame.lua:3:13  warning  WSL001  arithmetic on a secret value: 'hp' derives from UnitHealth() (SecretReturns=true)
Core/UnitFrame.lua:4:4   warning  WSL002  comparison of a secret value: 'hp' derives from UnitHealth() (SecretReturns=true)
0 errors, 2 warnings
```

Exit code 0: these are reported, not gated. `--strict` turns the same two into errors and exit 1. Line 5 is deliberately silent: the wiki says calling `string.format` with a secret is fine, so flagging it would be a false positive.

Add the guard and it goes quiet:

```lua
if not issecretvalue(hp) and not issecretvalue(max) then
    local pct = hp / max * 100
    if hp < max then frame:Show() end
end
```

```
$ npx wow-secret-lint Core/Guarded.lua
0 errors, 0 warnings
```

Exit code 0.

### The 12.1 aura surface

The most common aura pattern in retail addons stopped working in 12.1. Per the [12.1 API changes](https://warcraft.wiki.gg/wiki/Patch_12.1.0/API_changes): *"APIs like GetUnitAuras and GetUnitAuraInstanceIDs will return a secret vector, meaning addon code will not be able to determine how many auras it contains or iterate through it."* `Core/Auras.lua`:

```lua
local auras = C_UnitAuras.GetUnitAuras('player'); for i = 1, #auras do print(auras[i].name) end
```

```
$ npx wow-secret-lint Core/Auras.lua
Core/Auras.lua:1:63  error  WSL012  length operator (#) on a secret value: 'auras' derives from C_UnitAuras.GetUnitAuras(), secret in 12.1 while auras are secret (combat, encounters, M+, PvP); show auras with an AuraContainer (AddAuraGroup/AddAuraSlot) instead
Core/Auras.lua:1:78  error  WSL012  indexed access on a secret value: 'auras' derives from C_UnitAuras.GetUnitAuras(), secret in 12.1 while auras are secret (combat, encounters, M+, PvP); show auras with an AuraContainer (AddAuraGroup/AddAuraSlot) instead
2 errors, 0 warnings
```

Exit code 1. Under `--patch=12.0` the same file reports zero findings and exits 0, because the pre-12.1 API really did return an iterable table. `if auras then` stays silent under both, since nil-checking the return is the sanctioned pattern.

None of this comes from Blizzard's generated documentation, which carries no marker for aura secrecy. The 12.1 behaviour is published only in the patch notes, so these rules seed their taint from a list transcribed there, and `--patch` selects whether that list is active.

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | no error-severity findings. Warnings alone never fail the build |
| 1 | at least one error, or warnings above `--max-warnings` |
| 2 | a file failed to parse, or a usage/runtime failure |

## GitHub Action

If you already run [BigWigsMods/luacheck](https://github.com/BigWigsMods/luacheck), this sits next to it. Two lines:

```yaml
jobs:
  luacheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - name: Luacheck linter
        uses: BigWigsMods/luacheck@main
        with:
          args: -q
+     - name: Secret value linter
+       uses: Booyaka101/wow-secret-lint@v1
```

Findings render as pull request annotations on the exact line, plus a table in the job summary.

Inputs:

| Input | Default | Description |
| --- | --- | --- |
| `path` | `.` | addon folder, `.toc`, or `.lua`. Several allowed, space separated |
| `patch` | `12.1` | patch surface to check; `12.0` pins the pre-12.1 rule set |
| `args` | `""` | extra CLI arguments, e.g. `--conditional=warn --disable=WSL011` |
| `format` | `github` | `github`, `stylish`, or `json` |

Outputs: `errors`, `warnings`.

## Rules

Every rule maps to one sentence Blizzard publishes. `wow-secret-lint --rules` prints the table with the source for each. WSL008, WSL012, WSL013, WSL014, WSL017 and WSL018 fail a build by default; the rest are warnings.

| Rule | Severity | What it catches |
| --- | --- | --- |
| WSL001 | warning, error with `--strict` | arithmetic on a secret value |
| WSL002 | warning, error with `--strict` | relational or equality comparison of a secret value |
| WSL003 | warning, error with `--strict` | calling a secret value as if it were a function |
| WSL004 | warning, error with `--strict` | length operator `#` on a secret value |
| WSL005 | warning, error with `--strict` | indexed access, indexed assignment, or a secret used as a table key |
| WSL006 | warning, error with `--strict` | secret passed to an API whose `SecretArguments` does not allow it |
| WSL007 | warning, error with `--strict` | boolean test on a secret whose documented return type is `bool` |
| WSL008 | error | registering `COMBAT_LOG_EVENT` or `COMBAT_LOG_EVENT_UNFILTERED` |
| WSL009 | warning | secret crosses into a function in this file that never guards it |
| WSL010 | warning | conditionally secret value used with no guard anywhere in scope |
| WSL011 | warning | `tostring()` on a secret value |
| WSL012 | error | 12.1: `#`, iteration, indexing or table-key use of a secret aura vector |
| WSL013 | error | 12.1: arithmetic, comparison or boolean test on a secret unit identity value |
| WSL014 | error | 12.1: removed or renamed symbol; each message names the replacement |
| WSL015 | warning | 12.1: deprecated `getglobal`/`setglobal` |
| WSL016 | warning | 12.1: `showCountdownFrame` passed to a private-aura API |
| WSL017 | error | 12.1: forbidden-aspect operation on an AuraButton or AuraContainer |
| WSL018 | error | 12.1: call of an aura API reached by index, slot or instance id |

WSL008 comes from the [12.0.0 API changes](https://warcraft.wiki.gg/wiki/Patch_12.0.0/API_changes): *"COMBAT_LOG_EVENT and COMBAT_LOG_EVENT_UNFILTERED will error when trying to register them."* Use `COMBAT_LOG_EVENT_INTERNAL_UNFILTERED` or the `C_CombatLog` namespace.

WSL011 is a warning on purpose. `tostring` is absent from the wiki's allowed list but is not listed as forbidden either, so it stays a warning until someone confirms it in game.

### The 12.1 rules in detail

**WSL012** taints `C_UnitAuras.GetUnitAuras`, `GetUnitAuraInstanceIDs`, `GetAuraSlots`, the by-index/slot/instance queries (`GetAuraDataByIndex`, `GetAuraDataBySlot`, `GetAuraDataByAuraInstanceID`, `GetBuffDataByIndex`, `GetDebuffDataByIndex`) and the by-spell lookups (`GetAuraDataBySpellName`, `GetUnitAuraBySpellID`, `GetPlayerAuraBySpellID`, `GetCooldownAuraBySpellID`), since the notes say all of the UnitAura APIs return full secrets or nil. The by-index family additionally Lua-errors at the call itself while auras are secret, so any downstream use of its result is broken either way. Boolean tests on aura returns are never flagged: the value is a table or nil, and nil-checking it is how the new contract is meant to be consumed. The guard idiom DBM and BigWigs actually ship, `if not aura or issecretvalue(aura.name) then return end`, is credited in full: indexing one field inside a guard call is the test itself, and a guard naming any field vouches for the whole aura. Auras Blizzard explicitly flags as non-secret still come back readable; static analysis cannot know which spell IDs those are, so an unguarded read of one is still reported.

**WSL013** covers every unit API the 12.1 notes name: `UnitClass`, `UnitClassBase`, `UnitRace`, `UnitSex`, `UnitSexBase`, `UnitIsOwnerOrControllerOfUnit`, `UnitPhaseReason`, `UnitGroupRolesAssigned`, `UnitGroupRolesAssignedEnum`, `UnitIsRaidOfficer`, `UnitInRaid`, `UnitIsPVP`, `UnitIsGroupLeader`, `UnitIsGroupAssistant`, `UnitLeadsAnyGroup`, `UnitGetAvailableRoles`, plus `UnitIsCharmed`/`UnitIsPossessed` which follow aura secrecy rather than identity. Every one of them also carries `SecretWhenUnitIdentityRestricted` in Blizzard's generated docs, so the notes and the docs agree. The findings come out of the same arithmetic, comparison and boolean-test checkers as WSL001/002/007; only the rule id and severity differ.

A literal `"player"` token is exempt, since a unit is never secret to itself, and the charm pair is additionally exempt for `"pet"` and `"vehicle"`, which the notes state outright. The token is resolved through a constant, so `local PLAYER = "player"` then `UnitClass(PLAYER)` is exempt too, and the exemption is dropped as soon as the variable is reassigned. A variable token is never exempt, because it can name an arena opponent.

The seventeenth API in that list, `GetInspectSpecialization`, is not here: the global was removed in the same patch, so it is a WSL014 finding pointing at `C_SpecializationInfo.GetInspectSpecialization`.

**WSL014** covers every symbol 12.1 removed or renamed: the two renames the notes spell out (`UIParentLoadAddOn` to `LoadAddOnWithErrorHandling`, `CanAccessObject` to `FrameScriptObject:CanBeAccessedInContext`), and all 19 entries of the Removed column of the patch's global function table. The count in that table header is what pins the list, so it is complete rather than a sample.

A replacement is named only where the notes state the rename outright, or where a bare global moved into a namespace under the same name and the target is present in the generated docs: `CanSurrenderArena` to `C_PvP.CanSurrenderArena`, `GetInspectSpecialization` to `C_SpecializationInfo.GetInspectSpecialization`, `GetInventorySlotInfo` to `C_PaperDollInfo.GetInventorySlotInfo`, and the private-aura sound pair to `C_UnitAuras.AddAuraSound`/`RemoveAuraSound`. The rest say only that the symbol is gone. Inventing a replacement would be worse than admitting there is none, and a same-name match across unrelated namespaces is a coincidence rather than a migration.

`SecureAuraHeaderTemplate` is caught both in a `CreateFrame` template list and in an XML `inherits` attribute, including comma-separated lists. Referencing `UIParentLoadAddOn` without calling it is not flagged, because `if UIParentLoadAddOn then` is how you feature-detect the old client.

**WSL016** exists because this one fails silently: `showCountdownFrame` was renamed `showCooldownFrame` in the private-aura anchor structures, the old field is ignored, and the cooldown swipe just stops appearing with no error to trace. It is caught both inline and through a local args table.

The rename is the minimal fix, but it is probably not the one you want. Reporting this to oUF ([#888](https://github.com/oUF-wow/oUF/issues/888)) produced a useful answer: private auras are unofficially deprecated as of 12.1, the whole element is slated for removal, and existing private auras are now surfaced through aura containers anyway. Blizzard's `Blizzard_AuraContainerSources.lua` carries `AuraContainerPrivateAuraSource` and reaches them via `C_UnitAurasPrivate.GetAllPrivateAuraInstanceIDs`, so a container shows them without a private aura anchor at all. If you are touching this code, migrate rather than rename. The rule reports it as a warning for exactly that reason.

**WSL018** is the one that catches code WSL012 cannot. The notes say the by-index, by-slot and by-instance-id aura APIs *"will Lua error when called by addons while auras are secret"*, so the call is the failure, not what you do with the result. It therefore fires even where the result is guarded perfectly. BigWigs is the worked example: it has zero WSL012 findings because it guards every aura it reads, and four WSL018 findings because it still reaches those auras through `GetAuraDataByIndex`. Guarding the result cannot save a call that already threw. The `C_TooltipInfo` aura calls are included, but their returns are not treated as secret vectors, because the notes make no claim about their shape.

**WSL017** knows a local is an AuraContainer or AuraButton when it comes from `CreateFrame("AuraContainer", ...)`/`CreateFrame("AuraButton", ...)` or arrives as the `initializeFrame` callback parameter of `AddAuraGroup`/`AddAuraSlot`/`AddItemEnchantment`, and it follows the value into a table field, so `self.buttons[i] = button` keeps the type. On those it flags `SetScript`/`HookScript`, event registration, input calls (`EnableMouse`, `RegisterForClicks`, `Click`, ...) and focus queries (`IsMouseOver`, ...), naming the forbidden aspect each one trips. Construction itself is never flagged.

### What it will never flag

The wiki has an explicit allowed list, and flagging any of it is a false positive that gets a linter uninstalled. Each of these has a passing negative test in `test/`:

- storing a secret in a variable, an upvalue, or as a value in a table
- passing a secret to a Lua function
- concatenating string or number secrets with `..`
- calling `string.concat`, `string.format` or `string.join` with a secret
- boolean tests on non-boolean secrets, e.g. `if UnitHealth(unit) then`

That last one is why WSL007 checks the documented return type before it fires. `UnitInRange` returns a `bool` and is `SecretReturns = true`, so `if UnitInRange(u) then` is an error. `UnitHealth` returns a `number`, so `if hp then` is silent.

### Guards

Taint is cleared inside a branch guarded by `issecretvalue`, `canaccessvalue`, `issecrettable`, `canaccesstable` or `hasanysecretvalues`, by a frame's `HasSecretValues` / `HasSecretAspect`, and at any `scrubsecretvalues` or `secretwrap` boundary. `and`-chains, `else` branches and early returns all work:

```lua
if issecretvalue(hp) then return end
local pct = hp / max * 100          -- silent, the early return guarded it
```

Almost every real addon wraps the raw guards. KkthnxUI ships `IsSecret`, BigWigs ships `self:IsSecret`. Any callee whose name starts with `is`/`has`/`hasany` + `secret`, or `canaccess`, is recognised as a guard automatically. For a wrapper with an unrelated name, pass it explicitly:

```bash
npx wow-secret-lint ./MyAddon --secret-guard=IsLocked --access-guard=CanRead
```

### Conditionally secret APIs

Blizzard marks a second tier in the generated docs: functions that return a secret only while a specific restriction is active. `C_Spell.GetSpellCooldown` carries `SecretWhenCooldownsRestricted`; `C_LFGList.GetSearchResultInfo` carries `SecretInChatMessagingLockdown`; `UnitGUID`, `UnitName` and `UnitClass` carry `SecretWhenUnitIdentityRestricted`. In practice that means "secret in PvP, in restricted instances, and for non-player or pet units in combat". Your code works fine right up until it does not.

Under the default `--patch=12.1`, the seven identity APIs WSL013 covers are promoted out of this tier and report as errors regardless of the `--conditional` setting. The rest of the tier is **off by default**, because measured against 12 real addons it produces about one warning per Lua file, which is a tax rather than a signal. Turn it on for a deeper audit:

```bash
npx wow-secret-lint ./MyAddon --conditional=warn    # report as warnings
npx wow-secret-lint ./MyAddon --conditional=error   # fail the build on them
```

It is precise about structure fields. Blizzard marks safe fields `NeverSecret = true`, so this reports line 13 and stays quiet on line 10:

```lua
local cooldown = C_Spell.GetSpellCooldown(spellID)
if not cooldown.isEnabled then     -- isEnabled is NeverSecret, silent
    return false
end
if cooldown.startTime ~= 0 then    -- startTime is not, reported
    return false
end
```

```
$ npx wow-secret-lint --conditional=warn Talents.lua
Talents.lua:13:5  warning  WSL002  comparison of a secret value: 'cooldown.startTime' derives from C_Spell.GetSpellCooldown() (conditionally secret: SecretWhenCooldownsRestricted)
0 errors, 1 warning
```

That is [BtWLoadouts#67](https://github.com/Breeni/BtWLoadouts/issues/67), reduced to its shape.

## Measured on real addons

Run against 12 real retail addons (BigWigs, LittleWigs, DBM, WeakAuras, Details, SpartanUI, KkthnxUI, oUF, Bartender4, Premade Groups Filter, BtWLoadouts, AdvancedInterfaceOptions), 1,997 Lua files reachable from a retail `.toc`:

| Mode | Errors | Warnings | Addons that would fail CI |
| --- | --- | --- | --- |
| `--patch=12.1` (default) | 379 | 121 | 9 of 12 |
| `--patch=12.1 --strict` | 489 | 11 | 9 of 12 |
| `--patch=12.0` | 20 | 90 | 3 of 12 |
| `--patch=12.0 --strict` | 110 | 0 | 5 of 12 |

The two `12.0` rows are identical to what v1.2.0 reported, which is the point of the flag. Everything above them is the 12.1 surface landing, concentrated exactly where the [PTR forum thread](https://us.forums.blizzard.com/en/wow/t/minicc-and-similar-addons-might-be-partially-broken-in-121/2310937) predicted breakage:

| Rule | Count | Where |
| --- | --- | --- |
| WSL012 | 148 | Details' aura scanning (80), SpartanUI (56), oUF classpower and its copy in KkthnxUI (5 each) |
| WSL013 | 169 | DBM's class-keyed tables, BigWigs, and role checks across most of the corpus |
| WSL018 | 36 | SpartanUI (18), Details (13), BigWigs (4), KkthnxUI (1) |
| WSL014 | 10 | mostly `GetInventorySlotInfo`, plus `GetInspectSpecialization`, `GetWeaponEnchantInfo` and SpartanUI's `UIParentLoadAddOn` |
| WSL016 | 3 | oUF `privateauras.lua:133` and both copies vendored into KkthnxUI and SpartanUI |
| WSL017 | 0 | no addon in the corpus uses AuraContainers yet; exercised by fixtures |

Two numbers are worth reading together. **DBM and BigWigs report no WSL012 at all**, because both already wrap every aura lookup in an `issecretvalue` guard and the analysis credits that idiom. **BigWigs still has four WSL018 findings**, because guarding the result does not help when the call itself is what errors. That pair is the honest summary of where the ecosystem is: the careful addons did the guard work, and the guard work is not enough.

A sample of the WSL012/WSL013 findings across every affected repo was read against its source by hand; each one performs an operation the 12.1 notes document as disallowed, on a value those notes document as secret, with no guard in scope. The pre-12.1 findings are unchanged from v1.2.0, where all 110 strict findings were read by hand.

Contamination from Classic-flavour code is 0, checked by resolving every retail `.toc` in each repo and matching it against the findings.

SpartanUI's `libs/oUF_Classic` and `libs/LibClassicDurations` do get flagged and that is correct: its single `.toc` declares `## Interface: 120100, 50504, 38002, 20506, 11509`, so those libraries are listed for retail too. Blizzard's own `BlizzardInterfaceCode` is in the corpus only as a parser stress test, 2,128 retail files with 0 parse errors, since its code runs untainted and cannot violate these rules.

## The open question on severity

This section is about the 12.0-era `SecretReturns` tier (WSL001-WSL007 on `UnitHealth` and friends), which stays a warning by default. It does not apply to WSL012/WSL013: those rest on the 12.1 notes stating the behaviour in plain language, not on a documentation marker whose runtime meaning is unconfirmed.

The Secret Values page says functions marked `SecretReturns = true` "unconditionally return secret values", and that is what the error tier is built on. There is evidence pulling the other way and you should know about it.

Searching the issue trackers of DeadlyBossMods, BigWigs, Details and WeakAuras finds **zero** reports mentioning `UnitHealth` and secret values, while this tool flags dozens of `UnitHealth`-derived findings across them. If `UnitHealth` really did hand a secret to tainted code on every call, `UnitHealth(uId) / UnitHealthMax(uId) * 100` in DBM-Core would throw on every boss pull for millions of users, and the trackers would show it.

Three explanations fit, and this project cannot currently tell them apart:

- the documented "unconditionally" is narrower in practice than it reads, and health values are only secret under the same restriction machinery as the `SecretWhen*` markers
- those lines really are throwing and the reports land on Discord and CurseForge rather than GitHub
- the addons are throwing and nobody has traced it back to a specific API yet

Settling it needs someone to run a flagged line in game and watch what happens, which is not something static analysis can do. This is why the default gates on `WSL008` alone. Registration errors are deterministic and documented. Everything else is reported as "this contradicts Blizzard's documentation", which is useful to know and is not the same as "this will break". If you confirm behaviour either way in game, please open an issue. That single data point is worth more than everything else in this README.


## Configuration

```
--format=<stylish|json|github>  output format (default: stylish)
--game=<retail|classic>         classic has no secret values and exits 0 immediately
--patch=<12.0|12.1>             patch surface the built-in rules check (default: 12.1);
                                12.0 pins the pre-12.1 rule set
--strict                        raise SecretReturns findings from warning to error
--conditional=<off|warn|error>  conditionally secret APIs (default: off)
--secret-guard=<names>          extra is-secret wrapper functions, comma separated
--access-guard=<names>          extra can-access wrapper functions, comma separated
--disable=<ids>                 rule ids to silence, e.g. WSL010,WSL011
--max-warnings=<n>              exit 1 when warnings exceed n
--snapshot=<path>               use a different API snapshot
--refresh                       rebuild the vendored API snapshot (the only networked command)
--rules                         print the rule table with its sources
```

## Where the data comes from

`data/api-snapshot.json` is built from Blizzard's generated API documentation, mirrored at [Gethe/wow-ui-source](https://github.com/Gethe/wow-ui-source) on the `live` branch. The current snapshot carries **10,098 documented functions and 752 structures**: 20 with `SecretReturns = true`, 310 conditionally secret, and per-field `NeverSecret` markers on 20 structures.

It is parsed with `luaparse`, not regexed, so nested tables and multi-line entries cannot skew it. Rebuild it any time:

```bash
npx wow-secret-lint --refresh
```

A scheduled workflow in this repo does that weekly and opens a pull request when the docs move.

The 12.1 aura and identity secrecy is deliberately **not** part of the snapshot: Blizzard's generated documentation carries no marker for it, only the patch notes describe it, so the WSL012/WSL013 API lists live in `src/rules.mjs` with the source quoted, and `--patch` gates them. There is one snapshot, and `--snapshot`/`--refresh` behave the same under either patch.

## Limitations and non-goals

- **No auto-fixing.** It tells you where; the fix is yours.
- **No runtime component and no in-game addon.** This is a build-time linter.
- **No Classic support.** Classic has no secret values, so `--game=classic` exits 0 immediately.
- **It cannot diagnose a taint-spread crash.** Some of the worst reports look like `attempt to perform arithmetic on local 'textHeight' (a secret number value, while execution tainted by 'YourAddon')` where every frame of the stack is a Blizzard file. Your addon tainted execution, and then Blizzard's code did the arithmetic. There is no forbidden operation in your Lua to point at, so this tool reports nothing. Running it over the real [aura-questor](https://github.com/lucascodev/aura-questor) source, which has exactly that open report, gives a clean run across 114 files. The regression fixture named after that issue reproduces the shape of the trace, not a finding in their code.
- **No cross-file interprocedural analysis in v1.** Taint follows plain assignment, table field stores, the return value of a file-local function, and one level of intra-file call-argument passing. A secret that leaves through a global and comes back in another file is not tracked.
- **No LuaJIT or Lua 5.4 syntax.** Files are parsed as Lua 5.1. WoW accepts a semicolon after `break`, which stock 5.1 does not, so a file that fails on 5.1 gets one retry under the 5.2 grammar before it is reported as a parse error.
- **Method calls are not resolved to a widget type**, so WSL006 only applies to plain and namespaced calls (`UnitHealth(...)`, `C_CVar.SetCVar(...)`), never to `frame:SetText(...)`. WSL017 is the one exception, and its typing is deliberately narrow: a local counts as an AuraContainer/AuraButton only when it comes straight from `CreateFrame` with a literal type string or from an `initializeFrame` callback. A button stored in a table field or passed across files is not tracked.
- **XML is followed for `<Script>`/`<Include>` and checked only for removed templates.** WSL014 reads `inherits` attributes in every `.xml` the `.toc` pulls in, so a declarative aura header is caught. Nothing else in the markup is analysed: widget scripts written inline in XML are not parsed as Lua.
- **`string.format` output is not tracked as secret.** The wiki names it as the sanctioned way to render a secret, and following it would flood every `SetText` call site. The trade is a known blind spot on `#string.format(...)`.
- A `.toc` listing a file that is not on disk warns and keeps going. A file that will not parse is reported and the run exits 2.

## Tests

```bash
npm test
```

181 tests. The suite covers every rule, the guard forms, the permitted-operations negative cases, the three reporters, the CLI surface, one violating and one clean fixture per 12.1 rule (`test/fixtures/rules-121/`), a fixture proving `--patch=12.0` reproduces the v1.2.0 output byte for byte (`test/fixtures/patch/`), and eight regression fixtures reconstructed from real shipped traces:

| Fixture | Issue |
| --- | --- |
| `kkthnxui-121-textheight-arithmetic` | [KkthnxUI#121](https://github.com/Kkthnx-Wow/KkthnxUI/issues/121) |
| `kkthnxui-119-map-icon-arithmetic` | [KkthnxUI#119](https://github.com/Kkthnx-Wow/KkthnxUI/issues/119) |
| `kkthnxui-118-secret-table-key` | [KkthnxUI#118](https://github.com/Kkthnx-Wow/KkthnxUI/issues/118) |
| `aura-questor-68-textheight-arithmetic` | [aura-questor#68](https://github.com/lucascodev/aura-questor/issues/68) |
| `betterfriendlist-133-missing-hassecretvalues-gate` | [BetterFriendlist#133](https://github.com/Hayato2846/BetterFriendlist/issues/133) |
| `premade-groups-filter-399-searchresult-index` | [premade-groups-filter#399](https://github.com/0xbs/premade-groups-filter/issues/399) |
| `btwloadouts-67-unguarded-cooldown-compare` | [BtWLoadouts#67](https://github.com/Breeni/BtWLoadouts/issues/67) |
| `combat-log-event-registration` | [Patch 12.0.0 API changes](https://warcraft.wiki.gg/wiki/Patch_12.0.0/API_changes) |

Each fixture reproduces the shape of the reported defect, not the exact runtime taint chain, and every one carries an `expected.json` pinning the rule id, line, severity and originating API. The header comment in each `input.lua` quotes the original trace.

## Contributing

A false positive is a bug and worth an issue. Include the Lua, the rule id, and what the API actually returns. A rule that fires on correct code is worse than a rule that misses.

## License

MIT
