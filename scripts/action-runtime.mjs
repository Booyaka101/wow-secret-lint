/**
 * The runtimes `runs.using` may name, and when GitHub takes each one off the
 * runners. An action declaring a removed runtime does not launch at all: the
 * runner cannot find the interpreter, so none of our code runs and there is no
 * fallback. Dates from GitHub's Node 20 deprecation changelog,
 * https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/
 */
import { readFileSync } from 'node:fs';

export const RUNTIMES = {
  node12: { removedOn: '2023-09-27' },
  node16: { removedOn: '2024-10-23' },
  node20: { removedOn: '2026-09-23' },
  node24: { removedOn: null },
  composite: { removedOn: null },
  docker: { removedOn: null },
};

// Move before the runner does, not on the day it stops working. Half a year is
// enough notice to rebuild, re-test and cut a release without a rush.
export const LEAD_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Locate the `using:` line inside the top-level `runs:` mapping, without a YAML
 * dependency. Block style only: a flow mapping (`runs: {using: node24}`) reads
 * as absent, which surfaces as a hard failure rather than a silent pass.
 * @returns {{line:number, value:string, quote:string}|null}
 */
function findUsing(text) {
  const lines = text.split(/\r?\n/);
  let inRuns = false;
  for (let i = 0; i < lines.length; i++) {
    // A blank or comment line belongs to no block, so it must not close one.
    // A comment at column 0 between `runs:` and `using:` is legal YAML.
    if (/^\s*(#.*)?$/.test(lines[i])) continue;
    if (/^\S/.test(lines[i])) {
      inRuns = /^runs:\s*(#.*)?$/.test(lines[i]);
      continue;
    }
    if (!inRuns) continue;
    const m = lines[i].match(/^\s+using:\s*(.+?)\s*(?:#.*)?$/);
    if (m) {
      const quote = /^['"]/.test(m[1]) ? m[1][0] : '';
      return { line: i, value: m[1].replace(/^['"]|['"]$/g, ''), quote };
    }
  }
  return null;
}

/** @returns {string|null} the declared runtime, unquoted. */
export function readUsing(file) {
  const found = findUsing(readFileSync(file, 'utf8'));
  return found && found.value;
}

/**
 * The same action.yml with a different `runs.using`, for probing a validator
 * whose schema does not know the real one. Only the line under `runs:` moves,
 * so an `inputs.using` of our own never gets rewritten by mistake.
 */
export function withRuntime(text, runtime) {
  const found = findUsing(text);
  if (!found) return text;
  const lines = text.split(/\r?\n/);
  lines[found.line] = lines[found.line].replace(
    /^(\s+using:\s*)(.+?)(\s*(?:#.*)?)$/,
    `$1${found.quote}${runtime}${found.quote}$3`
  );
  return lines.join('\n');
}

/** `ok: false` means change it now. */
export function checkRuntime(using, now = new Date()) {
  if (!using) return { ok: false, reason: 'action.yml declares no runs.using' };
  const known = RUNTIMES[using];
  if (!known) {
    return { ok: false, reason: `"${using}" is not a runtime GitHub supports (expected one of: ${Object.keys(RUNTIMES).join(', ')})` };
  }
  if (!known.removedOn) return { ok: true, reason: `"${using}" has no announced removal date` };
  const days = Math.floor((Date.parse(`${known.removedOn}T00:00:00Z`) - now.getTime()) / DAY_MS);
  if (days < 0) return { ok: false, reason: `"${using}" was removed from the runners on ${known.removedOn}; actions declaring it no longer launch` };
  if (days < LEAD_DAYS) return { ok: false, reason: `"${using}" is removed from the runners on ${known.removedOn}, ${days} day(s) away; move before then` };
  return { ok: true, reason: `"${using}" is removed on ${known.removedOn}, ${days} day(s) away` };
}
