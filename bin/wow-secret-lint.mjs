#!/usr/bin/env node
// wow-secret-lint CLI.
//
// Exit codes: 0 clean, 1 findings at error severity, 2 parse error or usage/runtime failure.

import process from 'node:process';
import { lintPaths, VERSION } from '../src/index.mjs';
import { format, FORMATS, counts } from '../src/report.mjs';
import { refreshSnapshot, writeSnapshot, loadSnapshot, SNAPSHOT_PATH, DEFAULT_REF } from '../src/apidata.mjs';
import { applyBaselineFile, writeBaseline } from '../src/baseline.mjs';
import { RULES, RULE_IDS, PATCHES, DEFAULT_PATCH, patchList, patchAtLeast } from '../src/rules.mjs';

const USAGE = `wow-secret-lint ${VERSION}
Static analysis for World of Warcraft retail addons: finds Secret Value violations
in Lua before they ship.

Usage:
  wow-secret-lint [options] <path>...

  <path>  an addon folder (its .toc files decide the file list), a .toc, or a .lua file.

Options:
  --format=<stylish|json|github>  output format (default: stylish)
  --game=<retail|classic>         classic has no secret values and exits 0 immediately
  --patch=<12.0|12.1|12.1.5|auto> which patch surface the built-in rules check
                                  (default: 12.1.5). An older value pins the rule set for
                                  addons still targeting an older client, byte for byte;
                                  auto reads the addon's own .toc Interface number
  --strict                        raise SecretReturns findings from warning to error.
                                  Off by default: see "the open question on severity"
                                  in the README before you gate CI on them.
  --conditional=<off|warn|error>  how to treat APIs Blizzard marks secret only under a
                                  runtime restriction, e.g. SecretWhenCooldownsRestricted
                                  or SecretInChatMessagingLockdown (default: off)
  --secret-guard=<names>          extra is-secret wrapper functions, comma separated.
                                  Names matching is*secret/has*secret are detected already.
  --access-guard=<names>          extra can-access wrapper functions, comma separated
  --disable=<ids>                 comma-separated rule ids to silence, e.g. WSL010,WSL011
  --max-warnings=<n>              exit 1 when warnings exceed n (default: unlimited)
  --baseline=<path>               suppress the findings recorded in this file and report
                                  only what is new since it was written
  --write-baseline=<path>         record every finding of this run to the file and exit 0,
                                  so an addon with a backlog can gate CI on new findings
  --snapshot=<path>               use a different API snapshot
  --refresh                       rebuild the vendored API snapshot from the public mirror
                                  (the only command that uses the network)
  --refresh-ref=<ref>             branch or tag of the mirror to rebuild from
                                  (default: ${DEFAULT_REF})
  --force                         let --refresh write a snapshot of an older client build
                                  than the one already vendored
  --rules                         print the rule table and exit
  --version                       print the version and exit
  -h, --help                      print this help and exit

Rules: ${RULE_IDS.join(' ')}
Docs:  https://github.com/Booyaka101/wow-secret-lint
`;

function fail(message, code = 2) {
  process.stderr.write(`wow-secret-lint: ${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const opts = {
    format: 'stylish',
    game: 'retail',
    patch: DEFAULT_PATCH,
    conditional: 'off',
    strict: false,
    disable: [],
    secretGuards: [],
    accessGuards: [],
    maxWarnings: Infinity,
    baseline: undefined,
    writeBaseline: undefined,
    snapshot: undefined,
    refresh: false,
    refreshRef: DEFAULT_REF,
    force: false,
    rules: false,
    help: false,
    version: false,
    paths: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      opts.paths.push(...argv.slice(i + 1));
      break;
    }
    if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg === '--version' || arg === '-v') opts.version = true;
    else if (arg === '--refresh') opts.refresh = true;
    else if (arg === '--force') opts.force = true;
    else if (arg === '--rules') opts.rules = true;
    else if (arg === '--strict') opts.strict = true;
    else if (arg.startsWith('--format')) opts.format = value(arg, argv, () => i++);
    else if (arg.startsWith('--game')) opts.game = value(arg, argv, () => i++);
    else if (arg.startsWith('--patch')) opts.patch = value(arg, argv, () => i++);
    else if (arg.startsWith('--conditional')) opts.conditional = value(arg, argv, () => i++);
    else if (arg.startsWith('--secret-guard')) opts.secretGuards.push(...value(arg, argv, () => i++).split(',').map((s) => s.trim()).filter(Boolean));
    else if (arg.startsWith('--access-guard')) opts.accessGuards.push(...value(arg, argv, () => i++).split(',').map((s) => s.trim()).filter(Boolean));
    else if (arg.startsWith('--disable')) opts.disable = value(arg, argv, () => i++).split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg.startsWith('--max-warnings')) opts.maxWarnings = Number(value(arg, argv, () => i++));
    else if (arg.startsWith('--write-baseline')) opts.writeBaseline = value(arg, argv, () => i++);
    else if (arg.startsWith('--baseline')) opts.baseline = value(arg, argv, () => i++);
    else if (arg.startsWith('--refresh-ref')) opts.refreshRef = value(arg, argv, () => i++);
    else if (arg.startsWith('--snapshot')) opts.snapshot = value(arg, argv, () => i++);
    else if (arg.startsWith('-')) throw new Error(`unknown option "${arg}"`);
    else opts.paths.push(arg);

    function value(a, list, bump) {
      const eq = a.indexOf('=');
      if (eq !== -1) return a.slice(eq + 1);
      bump();
      const next = list[i];
      if (next === undefined) throw new Error(`option "${a}" needs a value`);
      return next;
    }
  }
  return opts;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`wow-secret-lint: ${err.message}\n\n${USAGE}`);
    process.exit(2);
  }

  if (opts.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (opts.version) {
    // First line stays the bare version for scripts; the second says which API surface a
    // bug report was produced against.
    const snap = await loadSnapshot(opts.snapshot).catch(() => null);
    const about = snap && snap.patch ? `snapshot ${snap.patch} (build ${snap.build ?? 'unknown'}), generated ${snap.generated ?? 'unknown'}` : 'snapshot unavailable';
    process.stdout.write(`${VERSION}\n${about}\n`);
    return 0;
  }
  if (opts.rules) {
    for (const id of RULE_IDS) {
      process.stdout.write(`${id}  ${RULES[id].severity.padEnd(7)}  ${RULES[id].summary}\n          ${RULES[id].source}\n`);
    }
    return 0;
  }

  if (opts.refresh) {
    process.stderr.write(`rebuilding API snapshot from Gethe/wow-ui-source@${opts.refreshRef} ...\n`);
    let index;
    try {
      let last = 0;
      index = await refreshSnapshot({
        ref: opts.refreshRef,
        onProgress: ({ done, total }) => {
          if (done - last >= 50 || done === total) {
            last = done;
            process.stderr.write(`  ${done}/${total} documentation files\n`);
          }
        },
      });
    } catch (err) {
      fail(`--refresh failed: ${err.message}`);
    }
    const path = opts.snapshot ?? SNAPSHOT_PATH;
    const vendored = await loadSnapshot(path).catch(() => null);
    // The mirror tags a new patch before it moves the live branch, so a scheduled refresh
    // can otherwise walk the snapshot back onto a client build that is no longer current.
    if (!opts.force && vendored && vendored.build && index.build && index.build < vendored.build) {
      process.stderr.write(
        `wow-secret-lint: @${opts.refreshRef} is still ${index.patch ?? '?'} (build ${index.build}), older than ` +
          `the vendored ${vendored.patch ?? '?'} (build ${vendored.build}); left the snapshot alone. ` +
          `Pass --force to write it anyway.\n`
      );
      return 0;
    }
    await writeSnapshot(index, path);
    process.stderr.write(
      `wrote ${path}: patch ${index.patch ?? 'unknown'} build ${index.build ?? 'unknown'}, ` +
        `${index.functionCount} functions, ${index.secretReturnCount} with SecretReturns=true, ` +
        `${index.conditionalCount} conditionally secret, ${index.structureCount} structures\n`
    );
    if (index.failures && index.failures.length) {
      process.stderr.write(`  ${index.failures.length} file(s) could not be read: ${index.failures.map((f) => f.file).join(', ')}\n`);
    }
    return 0;
  }

  if (!FORMATS.includes(opts.format)) fail(`unknown format "${opts.format}" (expected one of: ${FORMATS.join(', ')})`);
  if (!['retail', 'classic'].includes(opts.game)) fail(`unknown game "${opts.game}" (expected retail or classic)`);
  if (opts.patch !== 'auto' && !PATCHES.includes(opts.patch)) {
    fail(`unknown --patch "${opts.patch}" (expected ${patchList()}, or auto)`);
  }
  if (!['warn', 'error', 'off'].includes(opts.conditional)) {
    fail(`unknown --conditional "${opts.conditional}" (expected warn, error or off)`);
  }
  for (const id of opts.disable) {
    if (!RULE_IDS.includes(id)) fail(`unknown rule id "${id}" in --disable (known: ${RULE_IDS.join(', ')})`);
  }
  if (Number.isNaN(opts.maxWarnings)) fail('--max-warnings needs a number');
  if (opts.baseline && opts.writeBaseline) fail('use either --baseline or --write-baseline, not both');
  if (!opts.paths.length) {
    process.stderr.write(`wow-secret-lint: no path given\n\n${USAGE}`);
    process.exit(2);
  }

  if (opts.game === 'classic') {
    if (opts.format === 'stylish') process.stdout.write('classic has no secret values; nothing to check\n');
    else if (opts.format === 'github') process.stdout.write('::notice::classic has no secret values; nothing to check\n');
    else process.stdout.write(`${JSON.stringify({ version: VERSION, game: 'classic', findings: [], parseErrors: [], summary: { errors: 0, warnings: 0, parseErrors: 0 } }, null, 2)}\n`);
    return 0;
  }

  const snapshot = await loadSnapshot(opts.snapshot).catch(() => null);
  if (snapshot && snapshot.patch && opts.patch !== 'auto' && !patchAtLeast(snapshot.patch, opts.patch)) {
    process.stderr.write(
      `wow-secret-lint: the vendored snapshot is patch ${snapshot.patch} but --patch is ${opts.patch}; ` +
        `the rules that read the snapshot are checking an older API surface. Run --refresh.\n`
    );
  }

  let merged;
  try {
    merged = await lintPaths(opts.paths, {
      game: opts.game,
      patch: opts.patch,
      conditional: opts.conditional,
      strict: opts.strict,
      disable: opts.disable,
      secretGuards: opts.secretGuards,
      accessGuards: opts.accessGuards,
      snapshotPath: opts.snapshot,
    });
  } catch (err) {
    fail(err.message);
  }

  if (opts.writeBaseline) {
    const baseline = await writeBaseline(opts.writeBaseline, merged).catch((err) => fail(`cannot write baseline: ${err.message}`));
    process.stdout.write(format(merged, opts.format) + '\n');
    process.stderr.write(
      `wrote ${opts.writeBaseline}: ${baseline.entries.length} entries covering ${merged.findings.length} findings\n`
    );
    return 0;
  }
  if (opts.baseline) await applyBaselineFile(merged, opts.baseline).catch((err) => fail(err.message));

  process.stdout.write(format(merged, opts.format) + '\n');

  const { errors, warnings } = counts(merged);
  if (merged.parseErrors.length) return 2;
  if (errors > 0) return 1;
  if (warnings > opts.maxWarnings) return 1;
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`wow-secret-lint: unexpected failure: ${err && err.stack ? err.stack : err}\n`);
    process.exit(2);
  });
