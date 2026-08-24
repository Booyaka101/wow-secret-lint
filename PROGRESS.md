# PROGRESS

**Status: v1.0.0 complete and verified locally. Not published (owner ships from the phone).**

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
- **Corpus measured** against 12 real retail addons (2,209 Lua files): 118 errors, 0 warnings at default settings. All 118 read against their source line by hand; 0 false positives. Blizzard's own `BlizzardInterfaceCode` (2,274 files) parses with 0 errors.

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

## Not done, and why

- **Nothing is published.** No npm publish, no git repo, no GitHub release, no Marketplace listing. The brief forbids it; the owner ships from the phone.
- The repo is **not a git repository yet**. `git init` is the first step of the publish sequence below.

## Publish sequence for the owner

1. `git init && git add -A && git commit -m "wow-secret-lint 1.0.0"`
2. `gh repo create Booyaka101/wow-secret-lint --public --source=. --push`
3. `gh repo edit --add-topic wow --add-topic warcraft --add-topic addon --add-topic lua --add-topic lint --add-topic static-analysis`
4. Wait for CI green on the exact commit (check-runs API, not `gh run watch`).
5. `npm publish` (needs an authenticated npm session; an agent cannot mint the token).
6. `git tag v1.0.0 && git tag -f v1 && git push --follow-tags --force origin v1`
7. `gh release create v1.0.0 --title "v1.0.0"`, then on the release edit page tick "Publish this Action to the GitHub Marketplace", category **Code quality**. This is the first listing, so it will hit the sudo interstitial.

Best first distribution step after that: a short reply on [KkthnxUI#121](https://github.com/Kkthnx-Wow/KkthnxUI/issues/121) and [aura-questor#68](https://github.com/lucascodev/aura-questor/issues/68), where people are actively hitting this trace, rather than a new self-promo post. Both are in the fixture corpus already, so the reply can be concrete about what it catches.

## If picking this back up

- `npm test` is the gate. `npm run lint:self` runs the tool on its own clean fixtures.
- The corpus harness lives outside the repo at `D:\tmp\wsl-corpus` (`measure.mjs`, `configs.mjs`, `verify.mjs`, `final.mjs`). Re-download with the repo list in `repos.txt` if that scratch directory is gone. Any new rule must be measured there before it ships; a rule that fires on a large fraction of the population is a tax, not a signal.
- `node bin/wow-secret-lint.mjs --refresh` after a patch day, then `npm test`, then commit the snapshot diff. The weekly workflow does this automatically and opens a PR.
