# PROGRESS

## 1.3.1, and two posts deliberately not made

**Status: 1.3.1 shipped. npm `latest`, release live, `v1` moved, 175 tests, CI green on the merge commit.**

Filed [oUF#888](https://github.com/oUF-wow/oUF/issues/888) for the `showCountdownFrame` bug. Verifying it before posting changed it twice, and both corrections mattered:

- The draft claimed KkthnxUI and SpartanUI both carry the bug. **KkthnxUI had already fixed it** in `8522b82` on 2026-08-28, three days earlier. Checking the live repo instead of the corpus tarball caught it. The sentence became corroboration (an independent maintainer made this exact rename) instead of a false accusation.
- The draft said the stale key is silently ignored. That cannot be verified without running the game, so it was cut. What replaced it is documented: `showCooldownFrame` carries `Default = false`, so an unset field means no spiral either way.
- Two of the verification steps were themselves untrustworthy and were discarded rather than leaned on: GitHub code search returned 0 for a string sitting in the raw file, and the first docs URL 404'd into an empty file that would have grepped as "field absent". The final evidence is all 612 generated doc files downloaded and grepped, plus Blizzard's own two callers.

**Did not post to SpartanUI.** Their `libs/oUF` is not a submodule, but their copy of `privateauras.lua` is byte-identical to oUF master and their history shows wholesale engine syncs (`Update the unit frame engine to oUF 14.0.0`, 2026-08-11). Asking them to diverge from upstream for a bug upstream is already tracking is noise. It arrives with their next sync.

**Did not comment on aura-questor#68.** Ran the tool over the real addon first: 114 files, and it does not diagnose that crash at all. The trace is taint spread, every frame is a Blizzard file, and the arithmetic is in Blizzard's widget code. A comment there would have been promotion wearing a diagnosis. That limit is now written into the README.

**What the run did find** was a false positive in 1.3.0 itself, the only finding in aura-questor and it was wrong: `local PLAYER = "player"` then `UnitClass(PLAYER)`. The `"player"` exemption resolved literal arguments only. Fixed in 1.3.1, corpus WSL013 104 to 103, 12.0 output unchanged. By this repo's own standard a rule that fires on correct code is worse than one that misses, so it went out as its own patch release rather than waiting.

The general lesson, and it is the same one as the 1.0.0 severity recast: running the tool against real source is worth more than any amount of reasoning about it. Both the false positive and the killed comment came out of one 30 second run.

---

**Status: 1.3.0 fully shipped. PR merged, CI green on the merge commit, tagged, published to npm, released, and the Marketplace listing picked up the new version by itself.**

| Thing | State |
| --- | --- |
| PR | [#2](https://github.com/Booyaka101/wow-secret-lint/pull/2) merged as `4119262` |
| CI on `4119262` | all 5 checks green (ubuntu/windows x node 20/22, plus the Action on itself) |
| Tags | `v1.3.0` and `v1` both at `4119262` |
| npm | `wow-secret-lint@1.3.0`, `latest`, verified by installing from the public registry into a clean directory and running the worked example |
| Release | https://github.com/Booyaka101/wow-secret-lint/releases/tag/v1.3.0, not a draft |
| Marketplace | live, now showing v1.3.0; no second factor needed, later releases do pick themselves up as expected |
| Action `patch` input | present in `action.yml` at the `v1` tag |

Last updated 2026-08-31. Earlier history (1.0.0 through 1.2.0, the Marketplace saga, the severity recast) is below the 1.3.0 section, unchanged.

## 1.3.0, the 12.1 upgrade

Patch 12.1 (Curse of Ula'tek) went live 2026-08-11. v1.2.0 reported a false clean on `for i = 1, #auras` over `C_UnitAuras.GetUnitAuras`, the most common aura pattern in retail addons. 1.3.0 adds the 12.1 surface as rules WSL012-WSL017 behind a `--patch` flag defaulting to `12.1`.

### Phase 0 verification (all passed, nothing blocked)

| Resource | Result |
| --- | --- |
| `Patch_12.1.0/API_changes` | fetched, all quoted sentences present: the "full secrets or nil" aura sentence, the identity API list, the renames, getglobal/setglobal, SecureAuraHeaderTemplate, the four forbidden aspects |
| `Patch_12.1.0` | "Release date: August 11, 2026", "Curse of Ula'tek" |
| Published README on GitHub | matches the local one, documents WSL001-011 and the 12.0 snapshot claim |
| Blizzard forum thread 2317456 | Jayem, 2026-06-18, all three quoted statements verbatim |
| Blizzard forum thread 2310937 | MrCool and brownie quotes verbatim |
| `showCountdownFrame` | NOT found by a summarised fetch, so pulled the raw wikitext: it is there, removed from `AddPrivateAuraAnchorArgs` and `UnitPrivateAuraAnchorInfo`, replaced by `showCooldownFrame`/`showCooldownEdge`/`showDispelIcon`. WSL016 names the real replacement |
| Cost model | everything free and public, no keys, no accounts |

### The design decision the snapshot forced

The brief said `--patch` should "choose which snapshot the built-in rules load". The data says otherwise, in two ways:

1. The current vendored snapshot (refreshed 2026-08-24 from the live branch) is already post-12.1 data, and it carries **no marker at all** for aura secrecy: `C_UnitAuras.GetUnitAuras` is `SecretReturns=false, conditional=null`. Blizzard documents aura secrecy only in the patch notes, never in the generated docs. A 12.1 snapshot with the needed data does not exist to load.
2. A "12.0 snapshot" never existed in this repo either; the tool was born on 24 Aug against post-12.1 docs.

So there is exactly one snapshot, unchanged, and `--patch` gates the rule surface: the WSL012/WSL013 API lists live in `src/rules.mjs` with the wiki sentences quoted as sources. `--snapshot` and `--refresh` are untouched. This is the "no second parallel snapshot mechanism" half of the brief's sentence, honoured over the literal first half.

### What is VERIFIED working

- **173 tests pass** (`npm test`), including one violating and one clean fixture per new rule, and 33 new tests for the 12.1 surface.
- **The brief's worked example is exact**: the one-liner produces two WSL012 findings at 1:63 and 1:78 with the tainting call and the AuraContainer/AddAuraGroup/AddAuraSlot suggestion, exit 1; `--patch=12.0` on the same file reports zero and exits 0. Verified in the repo, from the packed tarball in a scratch install, and via the Action entrypoint with `INPUT_PATCH`.
- **`--patch=12.0` reproduces v1.2.0 byte for byte**, pinned by `test/fixtures/patch/`: the baseline file was recorded with the real v1.2.0 binary before any code changed, and the test diffs against it. The corpus agrees: 20 errors / 90 warnings / 3-of-12 failing, and 110/0/5-of-12 strict, identical to the 1.2.0 measurements.
- **Corpus, 12 addons, 1,997 retail-reachable files** under the 12.1 default: 273 errors, 117 warnings, 8 of 12 would fail CI. WSL012=148, WSL013=104, WSL014=1, WSL016=3, WSL015=0, WSL017=0 (nobody uses AuraContainers yet; fixtures cover it). Real catches, read in source: oUF `privateauras.lua:133` passes the dead `showCountdownFrame` (so do its vendored copies in KkthnxUI and SpartanUI), SpartanUI calls the renamed `UIParentLoadAddOn`, Details reads unguarded aura fields in its scan loop, DBM keys tables on `UnitClass` results.
- **Clean-path install** from the packed tarball works; Action entrypoint runs with no node_modules, honours the new `patch` input, rejects a bad one with a one-line error.

### Judgment calls a reviewer should know about

1. **WSL012/WSL013 are errors without `--strict`**, unlike the SecretReturns tier. The 1.1.0 recast principle was "only gate on what Blizzard states outright"; the 12.1 notes state this outright ("will now either return full secrets or nil when called by addons"), and the brief demanded exit 1. The README separates the two epistemic tiers explicitly.
2. **The DBM guard idiom is credited.** First measurement flagged 335 WSL012, and reading DBM-Core showed why that was wrong: DBM and BigWigs already wrap every aura lookup in `if not t or self:issecretvalue(t.name) then return end`. Indexing one field inside a guard call is the test, and a guard on any field vouches for the whole aura. After crediting that, WSL012=148 and **DBM and BigWigs report zero WSL012**, which is the correct verdict on code that already did the work. Both refinements are gated to 12.1-category taints so the 12.0 byte-for-byte holds.
3. **Boolean tests on aura returns are never flagged**: the value is a table or nil, nil-checking is the sanctioned pattern, and 12.1 removed the AuraData structure from the docs so the type lookup cannot vouch for it.
4. **Token exemptions**: `UnitIsCharmed`/`UnitIsPossessed` skip literal player/pet/vehicle (documented in the notes); the other identity APIs skip literal "player" only (a unit is never secret to itself; the notes frame the change as preventing comparison of secret units). Variable tokens always taint.
5. **WSL013 covers the brief's seven APIs.** The notes list ten more identity APIs (`UnitGroupRolesAssigned`, `UnitInRaid`, `UnitIsPVP`, ...); they stay in the conditional tier (`--conditional=warn`) because promoting them to error was not asked for and was not measured. Listed below as the first candidate for 1.4.0.
6. **By-spell aura lookups are seeded too** (`GetPlayerAuraBySpellID` and friends), on the strength of "all of the UnitAura APIs"; the brief's list was index/slot/instance only. This is what makes the oUF classpower and Details findings visible.

### House rules review

- Clone check (difflib over all 85 functions in src/bin/action): highest new-function similarity 32% (`checkCreateFrameTemplates` vs `applyGuards`), nothing near the 60% bar. WSL012/013 have no bodies at all, they route through the existing checkers via `ruleFor()`; WSL014/015 share one table-driven check.
- No em dashes in README/CHANGELOG/PROGRESS, comments only for non-obvious constraints, no TODO on any path.
- The full suite was run in a real environment after the last code change: 173/173.

### Left for the owner

Only the outward-facing posts, held on the house rule that the owner owns final wording. Drafts are written and the targets were re-checked on 2026-08-31:

- **oUF, a new issue.** `elements/privateauras.lua:133` still passes `showCountdownFrame`, verified against upstream `master` today, not against the corpus tarball. 12.1 renamed it to `showCooldownFrame` and ignores the old name, so the cooldown swipe silently stops. No existing oUF issue mentions it (searched open and closed). KkthnxUI and SpartanUI vendor the same file, so one report fixes three addons. oUF is already tracking 12.1 in the open issue #873, so the repo is receptive.
- **aura-questor#68**, still open with 0 comments, is the one surviving 1.0.0-era candidate.
- **KkthnxUI#121 is now closed**, so that draft is dropped rather than posted late.

`npm publish` needed no OTP; the stored session had publish rights, though `npm profile get` and `npm access list` both 403, so the credential is a restricted token. Provenance is still absent and still needs Trusted Publishing or an `NPM_TOKEN` workflow, both behind npm's 2FA.

### Candidates for 1.4.0, in order of value

1. Promote the remaining ten identity APIs after measuring their corpus impact (`UnitGroupRolesAssigned(u) == "TANK"` is everywhere; needs the same guard-crediting care).
2. Flag calls of by-index/slot/instance aura APIs themselves under a dedicated message, since the 12.1 notes say the call Lua-errors while auras are secret; currently only result misuse is flagged.
3. Scan XML `inherits` attributes for `SecureAuraHeaderTemplate` while already following `<Script>`/`<Include>`.
4. Track AuraButtons through table fields (`self.buttons[i] = button` in `initializeFrame`), which is how bigger addons will actually hold them.
5. An in-game observation of the `SecretReturns` tier remains the single most valuable data point, unchanged from 1.1.0.

---

## History through 1.2.0

**Status then: v1.2.0 fully shipped. npm, GitHub release, and Marketplace listing all live.**

## Phase 0 verification (all passed, nothing blocked)

Every external resource in the brief was re-fetched this session:

| Resource | Result |
| --- | --- |
| `Gethe/wow-ui-source@live` UnitDocumentation.lua | HTTP 200, 117 KB. `UnitHealth` carries `SecretReturns = true`, `SecretArguments = "AllowedWhenUntainted"`, exactly as the brief quoted |
| GitHub contents API for `Blizzard_APIDocumentationGenerated` | HTTP 200, 613 entries, 612 `.lua` |
| `warcraft.wiki.gg/wiki/Secret_Values` | all 6 forbidden and 5 allowed sentences present verbatim, plus the immediate-Lua-error sentence and the guard list |
| `Patch_12.0.0/API_changes` | "COMBAT_LOG_EVENT and COMBAT_LOG_EVENT_UNFILTERED will error when trying to register them." confirmed in the raw wikitext, with `COMBAT_LOG_EVENT_INTERNAL_UNFILTERED` and the `C_CombatLog` namespace as the replacements |
| `BigWigsMods/luacheck` README | workflow shape confirmed (`actions/checkout@v7`, `uses: BigWigsMods/luacheck@main`, `args: -q`) |
| KkthnxUI #121, #119, #118 | all open, authors and timestamps match the brief |
| aura-questor #68 | open, reesesm2000, 2026-08-23T12:33:06Z, game 12.10 |
| BetterFriendlist #133, premade-groups-filter #399, BtWLoadouts #67 | all open with the quoted traces |
| `Ketho/vscode-wow-api` CHANGELOG | latest 0.22.3 (2026-02-24); zero mentions of secret values. The competitor gap in the brief is real |
| npm `wow-secret-lint`, GitHub `Booyaka101/wow-secret-lint` | both 404, name was free |

## The 1.1.0 recast (severity)

The tool printed `error` on findings resting on `SecretReturns = true`, which could not be confirmed to error in game. Since 1.1.0, `WSL008` is the only 12.0-era rule that fails a build by default; everything resting on `SecretReturns` reports as a warning, with `--strict` to raise it. Regression fixtures assert under `strict: true`.

## The 1.2.0 contamination measurement

Flavour-aware `.toc` discovery (`findTocFilesDeep` + `isRetailToc`): no top-level `.toc` means descend up to three levels; a folder whose every `.toc` targets Classic is skipped with a message; the blind walk announces itself. Classic contamination went from 8 of 118 strict findings (all WeakAuras) to 0 of 110.

## Marketplace, provenance, and the open severity question

- Marketplace listing is LIVE under Code quality. Lesson recorded: check for the TOTP "Use your authenticator app" button before the email second factor; never re-click the email trigger.
- No provenance on published versions; needs `NPM_TOKEN` or npm Trusted Publishing, both behind npm 2FA, owner-operated.
- **No in-game confirmation** of whether `SecretReturns` APIs hand a secret to tainted code on every call. The default is built so this does not decide whether the tool is correct. The README asks for exactly this one data point.
- The two issue comments (KkthnxUI#121, aura-questor#68) remain unposted, held on the house rule that the owner owns final wording.
