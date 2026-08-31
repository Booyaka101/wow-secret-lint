# Changelog

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
