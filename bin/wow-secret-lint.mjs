#!/usr/bin/env node
// wow-secret-lint CLI.
//
// Exit codes: 0 clean, 1 findings at error severity, 2 parse error or usage/runtime failure.

import process from 'node:process';
import { lintPaths, VERSION } from '../src/index.mjs';
import { format, FORMATS, counts } from '../src/report.mjs';
import { refreshSnapshot, writeSnapshot, SNAPSHOT_PATH } from '../src/apidata.mjs';
import { RULES, RULE_IDS } from '../src/rules.mjs';

const USAGE = `wow-secret-lint ${VERSION}
Static analysis for World of Warcraft retail addons: finds Secret Value violations
in Lua before they ship.

Usage:
  wow-secret-lint [options] <path>...

  <path>  an addon folder (its .toc files decide the file list), a .toc, or a .lua file.

Options:
  --format=<stylish|json|github>  output format (default: stylish)
  --game=<retail|classic>         classic has no secret values and exits 0 immediately
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
  --snapshot=<path>               use a different API snapshot
  --refresh                       rebuild the vendored API snapshot from the public mirror
                                  (the only command that uses the network)
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
    conditional: 'off',
    strict: false,
    disable: [],
    secretGuards: [],
    accessGuards: [],
    maxWarnings: Infinity,
    snapshot: undefined,
    refresh: false,
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
    else if (arg === '--rules') opts.rules = true;
    else if (arg === '--strict') opts.strict = true;
    else if (arg.startsWith('--format')) opts.format = value(arg, argv, () => i++);
    else if (arg.startsWith('--game')) opts.game = value(arg, argv, () => i++);
    else if (arg.startsWith('--conditional')) opts.conditional = value(arg, argv, () => i++);
    else if (arg.startsWith('--secret-guard')) opts.secretGuards.push(...value(arg, argv, () => i++).split(',').map((s) => s.trim()).filter(Boolean));
    else if (arg.startsWith('--access-guard')) opts.accessGuards.push(...value(arg, argv, () => i++).split(',').map((s) => s.trim()).filter(Boolean));
    else if (arg.startsWith('--disable')) opts.disable = value(arg, argv, () => i++).split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg.startsWith('--max-warnings')) opts.maxWarnings = Number(value(arg, argv, () => i++));
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
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (opts.rules) {
    for (const id of RULE_IDS) {
      process.stdout.write(`${id}  ${RULES[id].severity.padEnd(7)}  ${RULES[id].summary}\n          ${RULES[id].source}\n`);
    }
    return 0;
  }

  if (opts.refresh) {
    process.stderr.write('rebuilding API snapshot from Gethe/wow-ui-source@live ...\n');
    let index;
    try {
      let last = 0;
      index = await refreshSnapshot({
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
    const path = await writeSnapshot(index, opts.snapshot ?? SNAPSHOT_PATH);
    process.stderr.write(
      `wrote ${path}: ${index.functionCount} functions, ${index.secretReturnCount} with SecretReturns=true, ` +
        `${index.conditionalCount} conditionally secret, ${index.structureCount} structures\n`
    );
    if (index.failures && index.failures.length) {
      process.stderr.write(`  ${index.failures.length} file(s) could not be read: ${index.failures.map((f) => f.file).join(', ')}\n`);
    }
    return 0;
  }

  if (!FORMATS.includes(opts.format)) fail(`unknown format "${opts.format}" (expected one of: ${FORMATS.join(', ')})`);
  if (!['retail', 'classic'].includes(opts.game)) fail(`unknown game "${opts.game}" (expected retail or classic)`);
  if (!['warn', 'error', 'off'].includes(opts.conditional)) {
    fail(`unknown --conditional "${opts.conditional}" (expected warn, error or off)`);
  }
  for (const id of opts.disable) {
    if (!RULE_IDS.includes(id)) fail(`unknown rule id "${id}" in --disable (known: ${RULE_IDS.join(', ')})`);
  }
  if (Number.isNaN(opts.maxWarnings)) fail('--max-warnings needs a number');
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

  let merged;
  try {
    merged = await lintPaths(opts.paths, {
      game: opts.game,
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
