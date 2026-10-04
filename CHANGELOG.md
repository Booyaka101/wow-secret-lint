# Changelog

## Unreleased

### Fixed

- **Retail's 12.1 removals were reported against Forever addons that still have
  the symbol.** 1.8.1 made Forever read as retail 12.1.5, which is right for the
  secret-value rules but wrong for the removal list: Forever branched from a
  different base and kept 14 of the 23 entries in `REMOVED_CALLS`, including
  `GetWeaponEnchantInfo`, `GetInventorySlotInfo`, `CancelItemTempEnchantment`,
  `getglobal` and `setglobal`. A target whose every `## Interface` id is a
  Forever one now has those checked against a scan of the Forever client and
  suppressed where it still has them. A `.toc` listing a retail id as well keeps
  them, since that file loads where the symbol really is gone. Symbols absent
  from both, such as `UIParentLoadAddOn`, are unaffected, and no secret-value
  rule changes. Follow-up to #14.

### Added

- `data/forever-presence.json`, a presence-only scan of the Forever client
  (1.60.1 build 69893), rebuildable with `scripts/forever-presence.mjs`. Derived
  from [Thunderz96/forever-addon-kit](https://github.com/Thunderz96/forever-addon-kit)
  (MIT).
- `flavour` in the JSON report and on the `lint()` result, naming which surface
  a run used.

## 1.8.1 - 2026-09-30

### Fixed

- **WoW Forever addons were skipped as Classic.** Forever stamps its `.toc`
  files `## Interface: 16001`, five digits like every Classic flavour, so a
  Forever-only addon got `none targeting retail; nothing to check` and exit 0.
  Forever runs the Mainline client with Midnight's secret values, and Blizzard
  says it shares the 12.1.5 API. Interface ids from 16000 to 19999 now count as
  retail, and `--patch=auto` checks them against 12.1.5. A `.toc` listing both,
  like `120100, 16001`, gets the newer of the two surfaces rather than the one
  with the larger id. Reported in #14.

## 1.8.0 - 2026-09-26

The snapshot moves to patch 12.1.5 **build 69952** (mirror commit `5c9363cc`,
2026-09-22, the third 12.1.5 PTR round) from the first PTR build 69594 that
1.7.0 carried. The mirror moved its `12.1.5` tag forward in between, and the
weekly refresh only ever looked at `live`, so nothing picked it up on its own.

### Changed

- **`C_Intl` accepts secret text.** 25 `C_Intl` functions moved from
  `SecretArguments = "AllowedWhenUntainted"` to `"AllowedWhenTainted"`, so
  WSL006 no longer fires on `C_Intl.ToUpper`, `C_Intl.ToLower`,
  `C_Intl.Transliterate` and the rest. `C_Intl.CreateLocaleContext` did not
  move and still reports WSL006. `C_LocaleContext` is gone as a namespace (its
  22 entries left the snapshot): the functions are now methods on the object
  `CreateLocaleContext` returns. The README worked example is replaced with this
  change, reproduced in `test/fixtures/worked-example-intl/`.
- **Other surface changes in 69952.** `C_PvP.GetArenaOpponentSpec` is newly
  documented, with `SecretReturns = true`, and the legacy `GetArenaOpponentSpec`
  global resolves to it (the notes: "The GetArenaOpponentSpec API now returns
  secrets."). `IsRaidMarkerActive` gained
  `SecretInChatMessagingLockdown`. `DamageMeterCombatSource.sourceGUID` became
  conditionally secret. The `C_PvP` random training ground APIs split into arena
  and battleground variants, and `C_AdventureMap.GetNumMapInsets`,
  `GetNumQuestOffers`, `GetNumZoneChoices` and
  `C_UnitAuras.GetRefreshCarryOverDuration` are new. Counts: 10,242 functions
  (was 10,250), 21 with `SecretReturns` (was 20), 316 conditionally secret (was
  314), 760 structures.
- **Corpus numbers.** On the 12-addon corpus every mode gains the same five
  findings and loses none, all from `GetArenaOpponentSpec`: four WSL009
  warnings in oUF's arena preparation (`units.lua`, and its copies in KkthnxUI
  and SpartanUI) and one WSL002 on a `specID > 0` in SpartanUI's
  `oUF_PVPSpecIcons.lua`. Default 379 errors / 121 warnings becomes 379 / 126,
  `--strict` 489 / 11 becomes 490 / 15, `--patch=12.0` 20 / 90 becomes 20 / 95
  and `--patch=12.0 --strict` 110 / 0 becomes 111 / 4. `--patch` pins the rule
  set, not the snapshot, so the 12.0 and 12.1 rows move too. The recorded
  fixture baselines for `--patch=12.0` and `--patch=12.1` are unchanged byte
  for byte. No addon in the corpus passes a secret into `C_Intl`, and none
  triggers WSL022.
- **The weekly refresh tries the vendored patch tag before `live`.** With no
  `ref` input, the workflow rebuilds from the snapshot's own `ref` when that is
  a patch tag, then from `live`, and guards each against what came before it.
  If the tag is gone from the mirror, the run leaves a warning annotation and
  goes on to `live`.
  `scripts/guard-refresh.mjs` now also reverts a lower build of the same patch
  (or one with no build stamp), and takes `--against=<file>` so the second
  rebuild is judged against the first one rather than against `HEAD`.

### Added

- **WSL022** (warning, 12.1.5): secret text passed to `C_Intl.Transliterate`
  with a transliterator ID that runs `Null` or `Remove`, such as
  `Any-Null`, `[:Mn:] Remove` or `NFD; [:Nonspacing Mark:] Remove; NFC`. The
  function carries the `TransliteratorAllowed` precondition, whose
  `FailureMode` is `ReturnNothing`: the call returns nothing instead of
  erroring, so this stays a warning under `--strict`. The ID has to resolve in
  the file, as a literal, a local holding one, or a concatenation of those; an
  ID built at runtime is not reported.
- **Preconditions in the snapshot.** Functions that name a `Predicates` entry
  of type `Precondition` carry it as `preconditions`, and the snapshot has a
  top-level `preconditions` map with each one's failure mode and documentation
  (37 of them).
- The snapshot carries the two new texture aspects, `SetTexture` on
  `SimpleTextureBaseAPI:ClearSVG`, `SetColorTexture` and `SetSVG`, and
  `QueryRotation` on `GetRotation`. No rule reads them, because nothing
  documents which textures carry those aspects. Two other 12.1.5 notes, castbar
  IDs unique per unit token and 1-based offsets from
  `C_Intl.FindStringMatches` and `FindBreaks`, have no rule either. The README
  says why.

### Fixed

- **The weekly snapshot refresh walked the vendored snapshot backwards a patch.**
  `data/api-snapshot.json` is vendored from the `12.1.5` tag, because the mirror
  tags a patch before it moves `live` onto it. On 2026-09-14 the scheduled run
  rebuilt from `live`, which was still shipping 12.1.0 hotfixes and had reached
  build 69814, newer than the 12.1.5 tag's 69594. The content genuinely differed,
  so the old `skip-if-unchanged.mjs` guard kept it, the 12.1.5 surface vanished
  and 23 tests went red. The guard is now `scripts/guard-refresh.mjs` and
  compares the patch as well: a refresh on an older patch than the vendored one
  is reverted, and so is one that could not read the mirror's build stamp at all.
  Nothing in the published package changed.
- **A function the file defines now shadows a documented API of the same
  name.** Namespaced functions are also indexed under their bare names, so
  `local function round(v)` resolved to `math.round` and a secret passed to it
  reported WSL006. The same held for a global `function contains()` against
  `table.contains`, and for a local that redefines `UnitHealth`.
- **String constants are read only where they are in scope.** A parameter
  named like a file-level constant took the constant's value, and a local set
  inside one function stayed visible after it. Unit-token checks and WSL022
  both read these, so `local function strip(ID)` next to an unrelated
  `local ID = 'Any-Remove'` got a WSL022 on its call. No finding in the corpus
  moves with either fix.
- **Refresh workflow edge cases.** A rebuild that only changes the mirror ref
  or commit (`live` catching up to a build the tag already had) is now reverted
  like a timestamp-only one. A `live` rebuild that fails leaves a warning and
  keeps the tag step's result, unless the run asked for that ref explicitly. A
  refresh that breaks the tests still opens its pull request, says so in the
  body, and fails the run. `guard-refresh.mjs` takes `--against <file>` as well
  as `--against=<file>`.

## 1.7.0 - 2026-09-13

A runtime change with no change to any finding. GitHub removes Node 20 from the
Actions runners on **2026-09-23**, and the
`ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION` opt-out expires the same day. An
`action.yml` still declaring `node20` does not launch after that: the runner
cannot find the interpreter, so a consumer's
`- uses: Booyaka101/wow-secret-lint@v1` step fails before the linter runs, with
no fallback.

### Changed

- **`action.yml` declares `runs.using: node24`.** `action/index.mjs` and every
  rule are untouched. The action entry was driven end to end against
  `test/fixtures/worked-example-1215` under both Node 20.20.2 and Node 24.21.0:
  the annotations, the job summary and the `errors` / `warnings` outputs hash
  identically under each, 3 errors and 0 warnings either way. The full suite
  passes on both. This applies to the Action; the CLI still runs on Node 20 or
  newer, and `engines` is unchanged.

### Fixed

- **`action.yml` declared its outputs with composite-action syntax.** Both
  `errors` and `warnings` carried `value: ${{ steps.lint.outputs.<name> }}`,
  referencing a step id that does not exist in a JavaScript action. A JS action
  sets outputs by appending to `GITHUB_OUTPUT`, which `action/index.mjs` has
  always done, so the keys were dead weight rather than broken behaviour. They
  are gone, and `action.yml` now validates against the Actions metadata schema
  for the first time.

- **The reported version was hand-maintained in two places.** `src/index.mjs`
  hard-coded `VERSION` and the CLI test restated the same literal, so the two
  agreed with each other while neither was tied to `package.json`. This release
  is where that came due: the bump left `--version`, `tool.driver.version` in
  SARIF and `version` in `--format=json` all saying 1.6.0, and the suite stayed
  green because the test asserted the stale value. Caught by installing the
  packed tarball into a clean directory and running `--version`, not by the
  tests. The constant now carries the release and the test reads `package.json`
  rather than repeating a string.

### Added

- **`npm run validate:action`**, and an `action-validate` CI job running it.
  Nothing checked `action.yml` against a schema before, which is why the `value:`
  keys above sat there unnoticed through six releases.

  `@action-validator/core` last published 0.6.0 on **2024-02-23** and compiles
  its schema into a wasm blob, so the `runs.using` enum it carries is `node12` /
  `node16` / `node20` and there is no newer copy to point it at. Rather than
  skipping the check, `scripts/validate-action.mjs` narrows it: if the validator
  fails, it re-validates the same file with `using` swapped for one the schema
  accepts, and passes only when that clears every error. Any other error, at any
  path, still fails, which a test proves by planting an unrelated schema
  violation and asserting a non-zero exit.

- **Ten runtime checks** (`test/action-runtime.test.mjs`, 249 -> 259). They
  fail when `runs.using` names a runtime that is gone, or one within 180 days of
  its removal date. Setting `action.yml` back to `node20` turns the suite red
  today. The next runtime deadline arrives as a failing test rather than as a
  broken workflow. One of them re-plants the `value:` keys and asserts the
  validator rejects them.

- **README: runner requirements.** Node 24 needs macOS >= 13.5, and Node.js
  publishes no `linux-armv7l` build for 24, so ARM32 self-hosted runners cannot
  run the Action. Both are stated rather than glossed.

### Internal

- Workflows moved from `actions/checkout@v4` and `actions/setup-node@v4` to
  `@v5`. The v4 majors are themselves `node20` actions, so our own CI would have
  died on 2026-09-23 alongside everyone else's. The test matrix gained Node 24.

## 1.6.0 - 2026-09-07

The four things 1.5.0 left on the table. No rule changes; the 12.0 and 12.1 baselines and
the 12-addon corpus are byte-identical to 1.5.0.

### Added

- **`--baseline=<path>` and `--write-baseline=<path>`.** Record the findings an addon has
  today, then gate CI on what is new. Entries key on file, rule and message with a count,
  never on line and column, so edits above a known finding do not resurface it. Entries that
  no longer match are counted and the summary says to re-record. The GitHub Action takes the
  file through a new `baseline` input.
- **Widget types cross files, in `.toc` load order.** An AuraContainer, AuraButton, animation
  group or protected cooldown stored in a global, in `_G[...]`, or in the addon's private table
  (`local _, ns = ...` or `local ns = select(2, ...)`) is known to every file loaded after the
  one that created it, under whatever local name each file gives that table. A file that
  redeclares the name as a local keeps its own meaning. Separate targets on one command line
  do not share widgets.
- **WSL021 sees metatable hooks.** A handler installed with
  `hooksecurefunc(getmetatable(<a Cooldown>).__index, name, fn)` runs for every cooldown in
  the game, so its first parameter is a cooldown that may be protected and a protected method
  called on it is reported. Hooking a protected frame directly counts too. The guard the rule
  asks for, `if self:IsProtected() then return end`, is recognised and clears the frame for
  the rest of its block; `IsForbidden()` is not a substitute. OmniCC is clean under this
  because its handlers call a proxy `Cooldown` of their own, never `self`.
- **`--version` prints a second line** naming the snapshot patch and build the run uses. The
  first line is still the bare version. JSON output carries `snapshot.patch` and
  `snapshot.build` too.

### Fixed

- An early-exit guard (`if issecretvalue(x) then return end`) applied to the rest of its
  block was never released when the block ended, so the path stayed cleared for the rest of
  the file. No fixture and no corpus file changed output when this was fixed, but it was
  wrong, and the new `IsProtected` guard would have inherited it.

### Verified

- 249 tests. The recorded 12.0 and 12.1 baselines match byte for byte. The 12-addon corpus
  reports 379 errors and 121 warnings under both `--patch=12.1` and `--patch=12.1.5`, and
  489/11 under `--strict`, all unchanged; 4,218 further files at current HEADs report nothing
  from WSL019-WSL021.
- Along the way: a `local Frame = Frame` upvalue cache sent the hook-target resolver into
  infinite recursion on KkthnxUI and SpartanUI, caught by the corpus run before release.

## 1.5.0 - 2026-09-07

Patch 12.1.5 (build 69594) went live on 2026-09-03. This catches the linter up to it: the
snapshot, three new rules, and a new default `--patch` surface. `--patch=12.0` and
`--patch=12.1` produce v1.2.0's and v1.4.2's output byte for byte, which is now enforced by
recorded baselines rather than asserted.

### Added

- **WSL019** (error): querying the progress or running state of an animation that carries
  the new `QueryAnimationProgress` forbidden aspect, which *"prevents querying the progress
  of an animation or whether it is running"*.
- **WSL020** (error): adding an animation to, or reparenting one onto, a group that carries
  the new `AddAnimations` forbidden aspect, which *"prevents animations from being added or
  reparented"*. The reparenting half is `SimpleAnim:SetParent`, where the aspect is checked
  on the `parent` argument rather than on the receiver.
- **WSL021** (error): *"the `SetCooldown` and `Clear` cooldown APIs can no longer be called
  from tainted code when the cooldown frame itself is protected."* Blizzard marked six
  `FrameAPICooldown` methods `IsProtectedFunction = true` in 12.1.5 and none in 12.1, so the
  method list is read from the snapshot rather than transcribed.
- **`--patch=12.1.5`, and it is the new default.** `PATCHES` is ordered now, so rules gate on
  "at or after" a surface instead of a not-equals check against `12.0`.
- **`--patch=auto`** reads the addon's own `## Interface` number and checks the surface it
  actually ships against: 120105 and up gets 12.1.5, 120100 gets 12.1, older gets 12.0. It
  says so and falls back to the default when there is no `.toc` to read.
- **`--refresh-ref=<ref>`** rebuilds the snapshot from any branch or tag of the mirror, and
  `--force` overrides the new guard that stops a refresh walking the snapshot backwards onto
  an older client build. The mirror tags a build before it moves `live`, which is how 12.1.5
  arrived here on the day it shipped; the weekly refresh workflow now reports that as a
  no-op instead of a downgrade.

### Changed

- Refreshed `data/api-snapshot.json` from `Gethe/wow-ui-source@12.1.5`: 10,250 documented
  functions and 760 structures, up from 10,099 and 752, with 20 `SecretReturns` (unchanged)
  and 314 conditionally secret (up from 310). Every count is regenerated, not carried over.
  The new globals are in it, so WSL006 and WSL007 stop analysing 12.1.5 code against a
  snapshot that has never heard of `math.clamp`, `string.startswith`, `table.keys`,
  `C_Intl`, `C_Weather`, `C_Timer.NewTimedSignalMap` or `CreateFrameWithOptions`. A file
  passing a secret to `math.clamp`, `C_Intl.ToUpper` and `string.startswith` reports three
  WSL006 errors against this snapshot and zero against 1.4.2's, which is the whole point of
  the refresh. It also brought in a new conditional marker with no code change:
  `SecretWhenLuaTableHasSecretKeys` on `table.count`, `table.getcountinfo` and
  `table.isempty`.
- The snapshot now carries two more Blizzard markers, keyed by widget system because method
  names collide across widget types: `ChecksForbiddenAspects` (which forbidden aspect a
  method checks, and on which argument) and `IsProtectedFunction`. It also records the patch,
  build, commit and ref it was generated from.
- A `local` bound to a folded string constant (`"PetActionButton" .. 4 .. "Cooldown"`) now
  resolves the same way a plain string literal always did, and a numeric for-loop counter
  inside one folds to a digit, so `_G["ActionButton" .. i .. "Cooldown"]` is recognised in
  the loop every action-bar addon writes. A local or parameter that shares a Blizzard frame's
  name is never taken for the frame.
- The GitHub Action's `patch` input defaults to `12.1.5` and accepts `auto`.

### Verified

- 230 tests pass. `--patch=12.0` and `--patch=12.1`, with and without
  `--strict --conditional=warn`, reproduce v1.4.2's output over the whole fixture corpus
  byte for byte, recorded before any of this work started and checked by
  `test/patch1215.test.mjs`.
- On the 12-addon corpus the README measures, `--patch=12.1.5` reports the same 379 errors
  and 121 warnings as `--patch=12.1`: the three new rules add nothing and take nothing away.
  A second pass over each addon's current HEAD plus OmniCC, Dominos and Blizzard's own
  interface code, 4,076 further files, also reports nothing from them. Four days in, nobody
  has adopted the Pandemic animation APIs yet.
- One candidate finding was found and thrown out. An early draft treated a `Cooldown` created
  under a secure-template button as protected, which flagged SpartanUI's quest button.
  `ScriptRegion:IsProtected` says protection runs the other way: *"anchoring or parenting a
  protected frame to another frame makes that frame implicitly protected as well"*, so the
  child is not the one that changes. The inference was dropped and the rule now fires only
  where the file names one of Blizzard's action-button cooldowns or builds a `Cooldown` from
  a secure template.

## 1.4.2 - 2026-08-31

Data only. No rule, message or analysis behaviour changed.

### Changed

- Refreshed `data/api-snapshot.json` from `Gethe/wow-ui-source@live` so the published
  package carries the current documentation. Two entries moved out of 10,099:
  `UnitCanAssist` gained `canAssistImmunePC` and `canAssistUninteractable` arguments, and
  `UnitIsPlayerControlledOrGroupMember` was added. Neither carries `SecretReturns`, neither
  is conditionally secret, and neither appears in any 12.1 rule list.

Verified inert rather than assumed: the full suite passes against the new snapshot, and the
12-addon corpus produces the same 500 findings, identical on file, line, column, rule id and
severity. No structures changed and no functions were removed.

## 1.4.1 - 2026-08-31

### Changed

- **WSL016 now points at the migration, not just the rename.** Reporting the
  `showCountdownFrame` bug to oUF ([#888](https://github.com/oUF-wow/oUF/issues/888)) got
  it closed as not planned, with the reason that private auras are unofficially deprecated
  as of 12.1 and the element is slated for removal. The bug was not disputed. Verified the
  substance of the reply against Blizzard's live source: `Blizzard_AuraContainerSources.lua`
  carries `AuraContainerPrivateAuraSource` and reaches private auras through
  `C_UnitAurasPrivate.GetAllPrivateAuraInstanceIDs`, so an AuraContainer displays them with
  no private aura anchor at all. The message and the README now say to migrate rather than
  rename, and the rule stays a warning because of it.

## 1.4.0 - 2026-08-31

Closes every item that was sitting in PROGRESS as a next step. Nothing in the 12.1 notes
that this tool can check statically is left uncovered.

### Added

- **WSL018** (error): calling an aura API that reaches data by index, slot or instance id.
  The notes say those calls *"will Lua error when called by addons while auras are
  secret"*, so the call is the failure and the rule fires even where the result is guarded
  correctly. BigWigs is the case in point: zero WSL012 findings because it guards every
  aura it reads, four WSL018 findings because it still reaches them by index. The
  `C_TooltipInfo` aura calls are covered too, but their returns are not treated as secret
  vectors, because the notes make no claim about their shape.
- **WSL013 now covers all seventeen identity APIs** the notes name, not the seven of
  1.3.0. Each of the added eleven also carries `SecretWhenUnitIdentityRestricted` in the
  generated docs, so the notes and the docs agree. Corpus WSL013 goes 103 to 169.
- **WSL014 now covers every removed symbol**, all 19 entries of the Removed column of the
  patch's global function table, rather than the original four. The count in that table
  header pins the list, so it is complete. A replacement is named only where the notes
  state the rename or where a bare global moved into a namespace under the same name with
  the target present in the generated docs; the rest say only that the symbol is gone.
- **WSL014 reads XML `inherits` attributes.** `.toc` files were already being followed
  into `.xml` for `<Script>`/`<Include>`, so a `SecureAuraHeaderTemplate` declared in
  markup is now caught instead of being invisible to a Lua-only scan. Comma-separated
  inherit lists are handled.
- **WSL017 follows AuraButtons into table fields**, so `self.buttons[i] = button` inside
  an `initializeFrame` callback keeps the widget type and later operations on it are still
  checked.

### Measured

Corpus of 12 addons, 1,997 retail-reachable files: 379 errors and 121 warnings under the
12.1 default, 9 of 12 would fail CI. `--patch=12.0` is unchanged at 20 errors, 90
warnings, 3 of 12, still byte for byte what v1.2.0 reported. Every WSL014 finding was read
against its source line; they are `GetInventorySlotInfo`, `GetInspectSpecialization`,
`GetWeaponEnchantInfo` and `UIParentLoadAddOn` calls that will be nil in 12.1.

181 tests.

## 1.3.1 - 2026-08-31

### Fixed

- **WSL013 false positive on a unit token held in a constant.** The self-exemption for
  `"player"` only resolved a literal argument, so the common shape

  ```lua
  local PLAYER = "player"
  local _, classFile = UnitClass(PLAYER)
  local color = RAID_CLASS_COLORS[classFile]
  ```

  was reported even though the player is never secret to itself. A simple string local is
  now resolved back to its value, and the constant is dropped as soon as the variable is
  reassigned. Found by running 1.3.0 against [aura-questor](https://github.com/lucascodev/aura-questor),
  which went from one finding to a clean run. In the 12-addon corpus WSL013 drops from 104
  to 103 (the other one is Details). No other counts move, and `--patch=12.0` output is
  unchanged.

## 1.3.0 - 2026-08-31

Patch 12.1 ("Curse of Ula'tek", live 2026-08-11) widened the secret surface far beyond
12.0, and 1.2.0 reported a false clean on the most common aura pattern in retail addons.
This release adds the 12.1 surface and a `--patch` flag to pin the old one.

### Added

- `--patch=<12.0|12.1>` (default `12.1`), also exposed as the `patch` input of the GitHub
  Action. `12.0` reproduces the 1.2.0 rule surface byte for byte, for addons still
  targeting the older client.
- **WSL012** (error): forbidden operation on a secret aura vector. Taints the returns of
  `C_UnitAuras.GetUnitAuras`, `GetUnitAuraInstanceIDs`, `GetAuraSlots`, the
  by-index/slot/instance aura queries and the by-spell lookups; flags `#`,
  `pairs`/`ipairs` iteration, indexing and table-key use. Boolean-testing the return stays
  silent, because nil-checking it is the sanctioned pattern, and the shipped guard idiom
  (`if not aura or issecretvalue(aura.name) then return end`, as in DBM and BigWigs) is
  credited in full.
- **WSL013** (error): forbidden operation on a secret unit identity value, covering
  `UnitClass`, `UnitClassBase`, `UnitRace`, `UnitSex`, `UnitSexBase`, `UnitIsCharmed` and
  `UnitIsPossessed`, routed through the existing arithmetic, comparison and boolean-test
  checkers. Literal `"player"` (and `"player"`/`"pet"`/`"vehicle"` for the charm pair, per
  the 12.1 notes) is exempt.
- **WSL014** (error): removed or renamed symbols, each message naming the replacement:
  `SecureAuraHeaderTemplate`, `C_UnitAuras.TriggerPrivateAuraShowDispelType`,
  `CanAccessObject`, `UIParentLoadAddOn`.
- **WSL015** (warning): deprecated `getglobal`/`setglobal`.
- **WSL016** (warning): `showCountdownFrame` passed to a private-aura API. The field was
  renamed to `showCooldownFrame` and the old name is silently ignored, so the cooldown
  swipe disappears with no Lua error. Caught inline and through a local args table.
- **WSL017** (error): forbidden-aspect operations on AuraButtons and AuraContainers:
  script handler installation, event registration, input calls and focus queries, matched
  to the UntrustedScriptExecution, EventRegistrations, ScriptedInput and QueryFocus
  aspects. AuraButtons are recognised from `CreateFrame` and from `initializeFrame`
  callbacks; construction itself is never flagged.

### Measured

On the same 12-addon corpus as 1.2.0: `--patch=12.0` reproduces 1.2.0 exactly (20 errors,
90 warnings, 3 of 12 failing). The default 12.1 surface reports 273 errors and 117
warnings, failing 8 of 12, dominated by WSL012 (148) and WSL013 (104). DBM and BigWigs
report zero WSL012 because both already guard every aura lookup; the findings sit in the
addons that have not done that work yet. WSL016 catches the `showCountdownFrame` in oUF's
`privateauras.lua` and both vendored copies of it (KkthnxUI, SpartanUI).

WSL012 and WSL013 gate builds without `--strict`. Unlike the `SecretReturns` tier, they
rest on the 12.1 notes stating the behaviour outright ("will now either return full
secrets or nil when called by addons") rather than on a documentation marker.

### Clone check

The six rules reuse the existing machinery rather than shipping parallel bodies: WSL012
and WSL013 are taint seeds routed through the existing operator checkers via a one-line
rule-resolution step, and WSL014/WSL015 share one table-driven removed-call check. The
new standalone bodies (WSL016 field tracking, WSL017 widget tagging) parallel nothing in
the codebase; highest pairwise similarity across all new functions is below 40%.

## 1.2.0 - 2026-08-24

- Flavour-aware `.toc` discovery: descends up to three levels, skips folders whose every
  `.toc` targets Classic, announces blind walks. Fixed WeakAuras-style repos silently
  bypassing the `.toc` mechanism. Classic contamination in strict findings: 8 of 118 to 0
  of 110.

## 1.1.0 - 2026-08-24

- Only `WSL008` fails a build by default; everything resting on `SecretReturns` reports
  as a warning, with `--strict` to raise it. The default is correct under either reading
  of the documentation.

## 1.0.0 - 2026-08-24

- First release: rules WSL001-WSL011, taint tracking, guard detection, `.toc`/XML
  resolution, three reporters, GitHub Action, vendored snapshot of Blizzard's generated
  API documentation.
