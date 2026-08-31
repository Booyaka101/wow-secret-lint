// GitHub Action entrypoint. Runs the linter in-process against the checked-out workspace
// and writes annotations plus a job summary. No install step, so src/ resolves luaparse
// from vendor/ (see src/luaparse.mjs).

import { appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { lintPaths, VERSION } from '../src/index.mjs';
import { format, FORMATS, counts } from '../src/report.mjs';
import { RULE_IDS, PATCHES, DEFAULT_PATCH } from '../src/rules.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function input(name, fallback = '') {
  const key = `INPUT_${name.toUpperCase().replace(/ /g, '_')}`;
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

function splitArgs(raw) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(raw)) !== null) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

async function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  await appendFile(file, `${name}=${value}\n`, 'utf8');
}

async function summary(markdown) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  await appendFile(file, markdown, 'utf8');
}

function fail(message) {
  process.stdout.write(`::error::${message.replace(/\r?\n/g, '%0A')}\n`);
  process.exit(2);
}

const paths = splitArgs(input('path', '.'));
const extra = splitArgs(input('args', ''));
const fmt = input('format', 'github');

if (!FORMATS.includes(fmt)) fail(`unknown format "${fmt}" (expected one of: ${FORMATS.join(', ')})`);

const options = {
  conditional: 'off',
  strict: false,
  disable: [],
  secretGuards: [],
  accessGuards: [],
  game: 'retail',
  patch: input('patch', DEFAULT_PATCH),
};
let maxWarnings = Infinity;

for (let i = 0; i < extra.length; i++) {
  const a = extra[i];
  const eq = a.indexOf('=');
  const key = eq === -1 ? a : a.slice(0, eq);
  const val = () => (eq === -1 ? extra[++i] : a.slice(eq + 1));
  switch (key) {
    case '--strict':
      options.strict = true;
      if (eq !== -1) fail('--strict takes no value');
      break;
    case '--conditional':
      options.conditional = val();
      break;
    case '--game':
      options.game = val();
      break;
    case '--patch':
      options.patch = val();
      break;
    case '--disable':
      options.disable.push(...val().split(',').map((s) => s.trim()).filter(Boolean));
      break;
    case '--secret-guard':
      options.secretGuards.push(...val().split(',').map((s) => s.trim()).filter(Boolean));
      break;
    case '--access-guard':
      options.accessGuards.push(...val().split(',').map((s) => s.trim()).filter(Boolean));
      break;
    case '--max-warnings':
      maxWarnings = Number(val());
      break;
    case '--snapshot':
      options.snapshotPath = val();
      break;
    default:
      fail(`unknown value in "args": ${key}`);
  }
}

if (!['off', 'warn', 'error'].includes(options.conditional)) {
  fail(`unknown --conditional "${options.conditional}" (expected off, warn or error)`);
}
if (!['retail', 'classic'].includes(options.game)) {
  fail(`unknown --game "${options.game}" (expected retail or classic)`);
}
if (!PATCHES.includes(options.patch)) {
  fail(`unknown patch "${options.patch}" (expected ${PATCHES.join(' or ')})`);
}
for (const id of options.disable) {
  if (!RULE_IDS.includes(id)) fail(`unknown rule id "${id}" in --disable`);
}
if (Number.isNaN(maxWarnings)) fail('--max-warnings needs a number');

if (options.game === 'classic') {
  process.stdout.write('::notice::classic has no secret values; nothing to check\n');
  await setOutput('errors', 0);
  await setOutput('warnings', 0);
  process.exit(0);
}

options.snapshotPath ??= join(HERE, '..', 'data', 'api-snapshot.json');

let merged;
try {
  merged = await lintPaths(paths, options);
} catch (err) {
  fail(err.message);
}

process.stdout.write(format(merged, fmt) + '\n');

const { errors, warnings } = counts(merged);
await setOutput('errors', errors);
await setOutput('warnings', warnings);

const rows = merged.findings
  .slice(0, 50)
  .map((f) => `| \`${f.file}:${f.line}:${f.column}\` | ${f.severity} | ${f.ruleId} | ${f.message.replace(/\|/g, '\\|')} |`)
  .join('\n');

await summary(
  `## wow-secret-lint ${VERSION}\n\n` +
    `${merged.filesScanned} Lua file(s) scanned against ${merged.snapshot.functionCount ?? 0} documented APIs ` +
    `(${merged.snapshot.secretReturnCount ?? 0} with \`SecretReturns=true\`).\n\n` +
    `**${errors} error(s), ${warnings} warning(s)**` +
    (merged.parseErrors.length ? `, ${merged.parseErrors.length} parse error(s)` : '') +
    '\n\n' +
    (rows
      ? `| Location | Severity | Rule | Message |\n| --- | --- | --- | --- |\n${rows}\n` +
        (merged.findings.length > 50 ? `\n_${merged.findings.length - 50} more not shown._\n` : '')
      : '_No findings._\n')
);

if (merged.parseErrors.length) process.exit(2);
if (errors > 0) process.exit(1);
if (warnings > maxWarnings) process.exit(1);
process.exit(0);
