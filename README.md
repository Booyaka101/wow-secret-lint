# wow-secret-lint

Static analysis for World of Warcraft **retail** addons. It maps where your Lua touches Blizzard's secret-value API, and hard-fails your build on the one thing that is certain to break.

Patch 12.0 introduced [secret values](https://warcraft.wiki.gg/wiki/Secret_Values). A lot of the API now hands your addon a value you are allowed to store, pass around and print, but not to do arithmetic on, compare, index, call, or measure with `#`. When tainted code does one of those, the wiki is blunt about the result:

> When an operation that is not allowed is performed, the result will be an **immediate** Lua error.

The failure is invisible until it happens at runtime, in someone else's game, in a stack trace that points at a Blizzard file:

```
...UIWidgets/Blizzard_UIWidgetTemplateTextWithState.lua:35: attempt to perform arithmetic
on local 'textHeight' (a secret number value, while execution tainted by 'KkthnxUI')
```

That one is [KkthnxUI#121](https://github.com/Kkthnx-Wow/KkthnxUI/issues/121), filed 2026-08-23. The identical trace was filed the same week against a completely unrelated addon, [aura-questor#68](https://github.com/lucascodev/aura-questor/issues/68). Both are in this repo's regression corpus.

`wow-secret-lint` reads Blizzard's own generated API documentation, tracks which of your locals hold a secret, and tells you where you touch one.

**It reports, it does not accuse.** Exactly one rule fails your build by default: `WSL008`, registering a combat log event, which Blizzard documents as a hard error. Everything else is a warning, because whether those APIs really hand a secret to tainted code on every call is not something static analysis can confirm. Run `--strict` to gate on the rest once you have decided you want that. [The reasoning is spelled out below](#the-open-question-on-severity) and it is worth two minutes before you wire this into CI.

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
| `args` | `""` | extra CLI arguments, e.g. `--conditional=warn --disable=WSL011` |
| `format` | `github` | `github`, `stylish`, or `json` |

Outputs: `errors`, `warnings`.

## Rules

Every rule maps to one sentence Blizzard publishes. `wow-secret-lint --rules` prints the table with the source for each. Only `WSL008` fails a build by default.

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

WSL008 comes from the [12.0.0 API changes](https://warcraft.wiki.gg/wiki/Patch_12.0.0/API_changes): *"COMBAT_LOG_EVENT and COMBAT_LOG_EVENT_UNFILTERED will error when trying to register them."* Use `COMBAT_LOG_EVENT_INTERNAL_UNFILTERED` or the `C_CombatLog` namespace.

WSL011 is a warning on purpose. `tostring` is absent from the wiki's allowed list but is not listed as forbidden either, so it stays a warning until someone confirms it in game.

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

That tier is **off by default**, because measured against 12 real addons it produces about one warning per Lua file, which is a tax rather than a signal. Turn it on for a deeper audit:

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

Run against 12 real retail addons (BigWigs, LittleWigs, DBM, WeakAuras, Details, SpartanUI, KkthnxUI, oUF, Bartender4, Premade Groups Filter, BtWLoadouts, AdvancedInterfaceOptions), 2,209 Lua files:

| Mode | Errors | Warnings | Addons that would fail CI |
| --- | --- | --- | --- |
| default | 20 | 90 | 3 of 12 |
| `--strict` | 110 | 0 | 5 of 12 |

Every one of the 20 default errors is `WSL008`, a combat log event registration that Blizzard documents as failing. Those are worth fixing today and nothing else in the default output can fail your build.

**All 110 are reachable from a retail `.toc`**, checked by resolving every retail `.toc` in each repo and matching it against the findings. Contamination from Classic-flavour code is 0. It was 8 before flavour-aware discovery landed, all of them WeakAuras, which ships only Classic `.toc` files in its repo and was being scanned by a blind directory walk.

All 110 were read against their source line by hand and **none contradicts the documented rule**. That is the strongest claim this project can honestly make, and it is not the same as "these 118 lines error in game". Read the next section before you reach for `--strict`.

SpartanUI's `libs/oUF_Classic` and `libs/LibClassicDurations` do get flagged and that is correct: its single `.toc` declares `## Interface: 120100, 50504, 38002, 20506, 11509`, so those libraries are listed for retail too. Blizzard's own `BlizzardInterfaceCode` is in the corpus only as a parser stress test, 2,274 files with 0 parse errors, since its code runs untainted and cannot violate these rules.

## The open question on severity

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

## Limitations and non-goals

- **No auto-fixing.** It tells you where; the fix is yours.
- **No runtime component and no in-game addon.** This is a build-time linter.
- **No Classic support.** Classic has no secret values, so `--game=classic` exits 0 immediately.
- **No cross-file interprocedural analysis in v1.** Taint follows plain assignment, table field stores, the return value of a file-local function, and one level of intra-file call-argument passing. A secret that leaves through a global and comes back in another file is not tracked.
- **No LuaJIT or Lua 5.4 syntax.** Files are parsed as Lua 5.1. WoW accepts a semicolon after `break`, which stock 5.1 does not, so a file that fails on 5.1 gets one retry under the 5.2 grammar before it is reported as a parse error.
- **Method calls are not resolved to a widget type**, so WSL006 only applies to plain and namespaced calls (`UnitHealth(...)`, `C_CVar.SetCVar(...)`), never to `frame:SetText(...)`.
- **`string.format` output is not tracked as secret.** The wiki names it as the sanctioned way to render a secret, and following it would flood every `SetText` call site. The trade is a known blind spot on `#string.format(...)`.
- A `.toc` listing a file that is not on disk warns and keeps going. A file that will not parse is reported and the run exits 2.

## Tests

```bash
npm test
```

123 tests. The suite covers every rule, the guard forms, the permitted-operations negative cases, the three reporters, the CLI surface, and eight regression fixtures reconstructed from real shipped traces:

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
