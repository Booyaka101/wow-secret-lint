#!/usr/bin/env node
/**
 * `action-validator action.yml`, minus the one thing its schema gets wrong.
 *
 * @action-validator/core last shipped 0.6.0 on 2024-02-23 and its schema is
 * compiled into a wasm blob, so the `runs.using` enum it carries is node12 /
 * node16 / node20 and cannot be pointed at a newer copy. node24 is a real
 * runner runtime, and after 2026-09-23 it is the only one, so a 2024 enum must
 * not decide what we ship. Rather than skipping the check, this narrows it: if
 * swapping `using` for a value the schema does accept clears every error, then
 * the runtime string was the sole objection and the rest of the file is valid.
 * Anything else the validator says still fails the build.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { basename, join, resolve } from 'node:path';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import process from 'node:process';

import { readUsing, withRuntime, checkRuntime } from './action-runtime.mjs';

// What the 0.6.0 schema's `runs.using` enum actually holds. If the declared
// runtime is already in it, the validator's verdict is final: probing would swap
// one runtime the schema accepts for another and pull in errors from a different
// branch of the `runs` oneOf. A composite action missing `steps:` came back
// "valid" that way, and a composite action with one real error came back with
// sixty lines of invented ones.
const SCHEMA_RUNTIMES = new Set(['node12', 'node16', 'node20', 'composite', 'docker']);

// What the probe swaps in for a runtime the schema has never heard of.
const SCHEMA_KNOWN_RUNTIME = 'node20';

const CLI = createRequire(import.meta.url).resolve('@action-validator/cli/cli.mjs');
const target = resolve(process.argv[2] ?? 'action.yml');

if (!existsSync(target)) {
  console.error(`validate-action: no such file: ${target}`);
  process.exit(1);
}

function validate(file) {
  // action-validator picks action-vs-workflow from the FILENAME, so a copy has
  // to keep the name `action.yml` or it is checked against the workflow schema.
  const r = spawnSync(process.execPath, [CLI, file], { encoding: 'utf8' });
  return { ok: r.status === 0, output: (r.stdout ?? '') + (r.stderr ?? '') };
}

function reportFailure(output) {
  console.error(`validate-action: ${basename(target)} failed validation.\n`);
  console.error(output.trim());
  process.exit(1);
}

const using = readUsing(target);
const runtime = checkRuntime(using);
if (!runtime.ok) {
  console.error(`validate-action: ${runtime.reason}`);
  process.exit(1);
}

const direct = validate(target);
if (direct.ok) {
  console.log(`validate-action: ${basename(target)} is valid (runs.using: ${using}, ${runtime.reason}).`);
  process.exit(0);
}

// The schema knows this runtime, so the runtime is not what it objected to.
if (SCHEMA_RUNTIMES.has(using)) reportFailure(direct.output);

const tmp = mkdtempSync(join(tmpdir(), 'validate-action-'));
const probe = join(tmp, 'action.yml');
writeFileSync(probe, withRuntime(readFileSync(target, 'utf8'), SCHEMA_KNOWN_RUNTIME));
const swapped = validate(probe);
rmSync(tmp, { recursive: true, force: true });

if (swapped.ok) {
  console.log(
    `validate-action: ${basename(target)} is valid.\n` +
    `  The bundled @action-validator schema (0.6.0, 2024-02-23) rejects runs.using: ${using};\n` +
    `  it validates clean as ${SCHEMA_KNOWN_RUNTIME}, so the runtime enum was the only objection.`
  );
  process.exit(0);
}

// The probe's errors, not the direct run's. This line is only reachable for a
// runtime outside the enum, where the direct run leads with the complaint this
// wrapper exists to drop.
reportFailure(swapped.output);
