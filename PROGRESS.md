# PROGRESS

**Status: v1.2.0. Default gates only on what is certain, discovery is flavour-aware, Classic contamination measured at 0.**

Last updated 2026-08-24.

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
| npm `wow-secret-lint`, GitHub `Booyaka101/wow-secret-lint` | both 404, name is free |

Cost model: everything used is free and public. No paid key, account, or hosting is required.

## What is VERIFIED working

- **Worked example matches the brief byte for byte**, including columns, and the guarded variant exits 0.
- **123 tests pass** (`npm test`): 6 files covering every rule, every guard form, the permitted-operations negatives, `.toc`/XML resolution, the three reporters, the CLI surface, and 8 regression fixtures.
- **Snapshot is real Blizzard data**: 10,098 functions, 752 structures, 20 `SecretReturns = true`, 310 conditionally secret. `--refresh` rebuilds it from the live mirror with 0 download or parse failures, and two independent refreshes are byte-identical apart from the timestamp.
- **Clean-path install verified** from the packed tarball in a scratch directory (PowerShell and Git Bash), including with `HTTP_PROXY`/`HTTPS_PROXY` pointed at a dead port to prove no network use.
- **GitHub Action entrypoint verified** by extracting the tarball with no `node_modules` at all and running `action/index.mjs`. luaparse resolves from `vendor/`. Annotations, `errors`/`warnings` outputs and the job summary all land.
- **Corpus measured** against 12 real retail addons (2,209 Lua files): 118 errors, 0 warnings at default settings. All 118 read against their source line by hand, and none contradicts the documented rule. That is NOT the same as "these error in game", see the open question below. Blizzard's own `BlizzardInterfaceCode` (2,274 files) parses with 0 errors.

## Design decisions the measurement forced

The first corpus run produced 2,110 findings and 247 parse errors. Four real defects came out of it, each fixed and covered by a test:

1. **`break;` is valid in WoW's Lua but not stock 5.1.** 229 of Blizzard's own files failed to parse. Now retries under the 5.2 grammar before reporting a parse error.
2. **Real addons load Lua through `.xml`.** oUF and LittleWigs scanned 0 files. `<Script>` and `<Include>` are now followed recursively; corpus coverage went from 3,229 to 4,483 files.
3. **`.toc` load directives** (`Locales\[TextLocale].lua [AllowLoadTextLocale deDE, ...]`) were treated as missing files.
4. **Addon-defined guard wrappers.** KkthnxUI ships `IsSecret`, BigWigs ships `self:IsSecret`. Not recognising them made every correctly-guarded read a false positive. Now detected by name, with `--secret-guard` / `--access-guard` for wrappers that do not match.

The **conditional tier defaults to off**. Measured at `warn` it emits 2,166 warnings on the same corpus (1.03 per Lua file), which is a tax rather than a signal. It is one flag away and the README publishes both numbers.

**WSL007 does not fire on documented non-boolean secrets.** The brief specified a warning there, but the wiki explicitly permits boolean tests on non-boolean secrets, so a warning would be a false positive on correct code. It errors when the documented return type is `bool`, warns when the type is unknown, and stays silent otherwise.

## Ship checklist, marked honestly

| # | Requirement | Status |
| --- | --- | --- |
| 1 | Feature complete, no TODO on a user path | met |
| 2 | No mocks, placeholders or fake data | met. `data/api-snapshot.json` is parsed from Blizzard's live docs |
| 3 | Real end-to-end run on real input | met. Worked example, 8 fixtures, 4,483-file corpus, clean-path install, action with no node_modules |
| 4 | Handles bad input, missing files, empty results, network failure | met. Missing `.toc` entry warns and continues; unparseable file exits 2; unknown flags, unknown rule ids, missing snapshot and a dead network all give one-line messages with no stack trace |
| 5 | Tests covering the core path | met. `npm test`, 123 passing |
| 6 | Publish-ready packaging | met. package.json complete, bin wired, LICENSE (MIT), .gitignore, `action.yml` description is 70 chars (under the 125-char Marketplace limit) |
| 7 | README a stranger can follow | met, with real pasted output and the measured false-positive count |
| 8 | Version 1.0.0 | met |

## House-rules review (post-build)

Ran the mandated difflib check over all 61 functions in `src/`, `bin/` and `action/`. Nothing was above the 60% clone threshold, but three genuine shared mechanisms were duplicated and are now extracted:

- **One `walk(node, visit)`** replaces three hand-rolled AST traversals (`collectGuardedPaths`, the return-taint scan, and the parameter-guard scan), plus a shared `guardedPathsOf` that both guard scans now call. Highest pairwise similarity fell from 51% to 32%.
- **`lintPaths()` in `src/index.mjs`** replaces the run-and-merge loop that the CLI and the Action each had their own copy of (20 verbatim duplicated lines). `bin` vs `action` whole-file similarity fell from 21% to 12%.
- Dead code removed: unused `GUARDS`/`GUARD_METHODS` imports left over from the guard-wrapper refactor, an unread `Scope.fnBoundary` field, and an unused `TOC_SUFFIXES` constant.

Proved as a pure refactor rather than argued: 20 real outputs were recorded before the change (all fixtures at `--conditional` off/warn/error, all 15 corpus repos, `--rules`, `--help`, the parse-error path, and the Action entrypoint) and re-recorded after. **`diff -r` reports identical.** 123 tests still pass and the packed tarball still runs from a clean path.

Also checked: zero em dashes in any outward-facing file, no comment block over two lines outside the file headers, no TODO/FIXME/placeholder on any path, and `action.yml`'s description is 70 characters.

## Shipped

| Step | Result |
| --- | --- |
| GitHub repo | https://github.com/Booyaka101/wow-secret-lint, public, 7 topics |
| CI on the release commit `498fd61` | all 5 checks green (ubuntu/windows x node 20/22, plus the Action running on itself) |
| npm | `wow-secret-lint@1.0.0`, published, registry resolved in ~8s |
| Tags | `v1.0.0` and `v1` pushed |
| Release | https://github.com/Booyaka101/wow-secret-lint/releases/tag/v1.0.0 |
| Public install proof | `npm install wow-secret-lint` in a clean dir, ran the worked example, correct output, exit 1 |

## Left for the owner

**The GitHub Actions Marketplace listing.** `github.com/marketplace/actions/wow-secret-lint` is still 404. The first listing is UI-only: open the release edit page, tick "Publish this Action to the GitHub Marketplace", pick category **Code quality**, and clear the sudo interstitial. It needs a second factor out of your mailbox, so it was left to you rather than automated. Everything it depends on is already correct: `action.yml` has name, description (70 chars, under the 125 limit), author, and branding icon/colour, and the `v1` tag exists.

Once listed, later releases pick themselves up automatically; the sudo wall is only on the first listing.

**Provenance.** 1.0.0 was published from an authenticated local npm session, so it carries no provenance attestation, and npm does not allow republishing a version. To get provenance from 1.0.1 onward, either add an `NPM_TOKEN` secret (classic Automation token, never expires) and publish from a workflow with `--provenance`, or set up npm Trusted Publishing for the package. Both are behind npm's 2FA wall, so both are owner-operated.

## Best first distribution step

A short reply on [KkthnxUI#121](https://github.com/Kkthnx-Wow/KkthnxUI/issues/121) and [aura-questor#68](https://github.com/lucascodev/aura-questor/issues/68). Both are open, both are people hitting this exact trace right now, and both are already fixtures in the repo so the reply can be concrete about what it catches. Better reach than a self-promo post, and it does not trip low-effort rules.

## Open question that 1.0.1 documents rather than answers

The Secret Values page says `SecretReturns = true` means the function "unconditionally return[s] secret values", so the error tier follows the documentation. But DeadlyBossMods, BigWigs, Details and WeakAuras have **zero** issues mentioning `UnitHealth` and secret values, and this tool flags 66 `UnitHealth`-derived errors across them. If the documented reading were literally true at runtime, DBM would be throwing on every boss pull for millions of users.

Candidate explanations, currently indistinguishable from here: the documented wording is narrower in practice; the reports go to Discord and CurseForge instead of GitHub; or some flagged paths are Classic-flavour code that never runs on retail (true for at least some SpartanUI hits).

1.0.1 does not guess. It corrects the README claim from "0 false positives" to "none contradicts the documented rule", adds a section spelling out the tension, and points users at `WSL008` as the rule to trust unconditionally.

**Resolving it needs one in-game observation**, which static analysis cannot supply. Until then do not promote the error tier as "this will break your addon", and do not list on the Marketplace or post to the issue trackers on the strength of it.

**Do not repeat the original mistake:** I verified the rule against Blizzard's documentation and reported that as a false-positive rate. Those are different claims. A doc marker is a claim about intent; only the runtime is a claim about behaviour.

## 1.1.0, the recast

The tool printed `error` on findings resting on `SecretReturns = true`, which I could not confirm error in game. One word, and it turned an inventory into a verdict. That is what made 1.0.0 overclaim.

Now: `WSL008` is the only rule that fails a build by default, because combat log registration failure is documented and deterministic. Everything resting on `SecretReturns` reports as a warning, with `--strict` to raise it. The implementation is one line in `report()`, plus wiring, and rules with no taint behind them are untouched.

Measured on the same 12-addon corpus:

| Mode | Errors | Warnings | Addons that would fail CI |
| --- | --- | --- | --- |
| default | 22 | 96 | 4 of 12 |
| `--strict` | 118 | 0 | 6 of 12 |

All 22 default errors are `WSL008`. The point of the recast is that the default is now correct under either reading of the docs, which is the property 1.0.0 lacked.

Regression fixtures assert under `strict: true`, since they document contradictions of the documented rule. 127 tests.

Two process notes worth keeping. A patch script asserted mid-way and wrote nothing, so a later step silently no-oped and `--strict` parsed but never reached the analyser; only asserting on every replace caught it. And a naive `.findings;` replacement landed a paren in the wrong place and produced a syntax error, caught by the suite rather than by review.

### Still open

- Classic-flavour contamination in the 118 is real and unquantified. Next measurement.
- No in-game confirmation of whether `SecretReturns` APIs are secret on every call. Everything above is built so that answer no longer changes whether the default is correct.
- Marketplace listing and the two issue comments remain held.

## 1.2.0, the contamination measurement and the bug it found

Measured the Classic contamination in the 118 strict findings by resolving every retail `.toc` in each repo and matching the file lists against the findings. Retail interface ids have six digits (120001); every Classic flavour uses five (11507, 40402, 50504), which is a clean discriminator.

**Result: 8 of 118, 6.8%. All of them WeakAuras. None of them SpartanUI.**

My SpartanUI hypothesis was wrong and I had asserted it twice without checking. Its single `SpartanUI.toc` declares `## Interface: 120100, 50504, 38002, 20506, 11509`, a multi-flavour toc, so `libs/oUF_Classic` and `libs/LibClassicDurations` are listed for retail too. Those findings are legitimate.

The eight were a defect in this tool, not the corpus. WeakAuras keeps its tocs in a `WeakAuras/` subdirectory and ships only `_Cata`, `_Mists`, `_TBC`, `_Vanilla` and `_Wrath` variants. `findTocFiles` at the repo root found nothing, the code fell back to `collectLuaFiles`, and that walks every `.lua` while ignoring flavour entirely. Pointing the tool at any repo whose addon lives one level down silently abandoned the whole `.toc` mechanism, including the Classic filtering the README promises.

Fixed in `findTocFilesDeep` plus `isRetailToc`:

- no `.toc` at the top level means descend up to three levels before giving up
- a `.toc` is retail when any `## Interface` id is >= 100000; packager tokens like `@toc-version-retail@` count as retail rather than being silently dropped
- a folder whose every `.toc` targets Classic is skipped with a message instead of scanned
- the blind walk still exists for folders with no `.toc` anywhere, and now announces itself

Re-measured after the fix:

| Mode | Errors | Warnings | Addons that would fail CI |
| --- | --- | --- | --- |
| default | 20 | 90 | 3 of 12 |
| `--strict` | 110 | 0 | 5 of 12 |

118 to 110 is exactly the eight. Re-running the contamination check reports **0 of 110**, every finding reachable from a retail `.toc`. LittleWigs still resolves 752 files, so nested discovery did not regress the existing path. 132 tests.

Third time the same shell trap landed: `
` inside a python heredoc arrives as a real newline through the Bash tool and produced an unparseable test file. Rewrote the block with backtick template literals, where real newlines are legal, which sidesteps the escaping entirely. That is the durable fix, not more careful escaping.

### Still open

- No in-game confirmation of whether `SecretReturns` APIs are secret on every call. The default is built so this no longer changes whether it is correct.
- Marketplace listing and the two issue comments remain held.
