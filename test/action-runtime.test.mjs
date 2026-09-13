import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LEAD_DAYS, RUNTIMES, checkRuntime, readUsing, withRuntime } from '../scripts/action-runtime.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ACTION_YML = join(ROOT, 'action.yml');
const VALIDATE = join(ROOT, 'scripts', 'validate-action.mjs');

function withTempAction(body, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'wsl-action-'));
  try {
    const p = join(dir, 'action.yml');
    writeFileSync(p, body);
    return fn(p);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// GitHub removes Node 20 from the runners on 2026-09-23. An action.yml still
// declaring it does not launch that day: the runner cannot find the
// interpreter, so the step fails before the linter runs. These are the alarm,
// and they fire while there is still time to cut a release.
describe('action.yml runtime', () => {
  it('declares a runtime GitHub still runs', () => {
    const r = checkRuntime(readUsing(ACTION_YML));
    expect(r.ok, r.reason).toBe(true);
  });

  it('rejects a runtime that is already gone', () => {
    expect(checkRuntime('node16').ok).toBe(false);
    expect(checkRuntime('node20', new Date('2026-09-24T00:00:00Z')).ok).toBe(false);
  });

  it('rejects a runtime inside the lead window, while it still works', () => {
    const r = checkRuntime('node20', new Date('2026-09-01T00:00:00Z'));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('2026-09-23');
    expect(LEAD_DAYS).toBeGreaterThanOrEqual(90);
  });

  it('accepts a runtime with no announced removal, rejects an unknown one', () => {
    expect(checkRuntime('node24').ok).toBe(true);
    expect(RUNTIMES.node24.removedOn).toBe(null);
    expect(checkRuntime('node26').ok).toBe(false);
    expect(checkRuntime(null).ok).toBe(false);
  });

  it('reads runs.using past quotes and comments, and ignores a lookalike key', () => {
    expect(withTempAction("runs:\n  using: 'node24'\n  main: x.mjs\n", readUsing)).toBe('node24');
    expect(withTempAction('runs:\n  using: node24 # pinned\n  main: x.mjs\n', readUsing)).toBe('node24');
    expect(withTempAction('inputs:\n  using:\n    default: node20\n', readUsing)).toBe(null);
  });

  it('rewrites runs.using and nothing else', () => {
    const decoy = "inputs:\n  using:\n    default: node20\nruns:\n  using: 'node24'\n  main: 'action/index.mjs'\n";
    const swapped = withRuntime(decoy, 'node20');
    // The decoy input keeps its own default: only the line under `runs:` moves.
    expect(swapped).toContain('    default: node20');
    expect(swapped).toContain("  using: 'node20'");
    expect(withRuntime('name: x', 'node20')).toBe('name: x');
  });
});

describe('validate:action', () => {
  it('passes action.yml despite the stale runs.using enum', () => {
    const r = spawnSync(process.execPath, [VALIDATE], { encoding: 'utf8' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });

  it('still fails on a schema error that is not the runtime', () => {
    const yml = readFileSync(ACTION_YML, 'utf8').replace(/^runs:$/m, 'bogus-top-level: 1\nruns:');
    const r = withTempAction(yml, (p) => spawnSync(process.execPath, [VALIDATE, p], { encoding: 'utf8' }));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('bogus-top-level');
  });

  // A JavaScript action sets its outputs by appending to GITHUB_OUTPUT. `value:`
  // is composite-only syntax, and it sat here referencing a `steps.lint` that
  // never existed until 1.7.0. Nothing validated action.yml, so nothing said so.
  it('rejects composite-only output syntax on this JavaScript action', () => {
    const yml = readFileSync(ACTION_YML, 'utf8').replace(
      "  errors:\n    description: 'Number of error-severity findings.'",
      "  errors:\n    description: 'Number of error-severity findings.'\n    value: \${{ steps.lint.outputs.errors }}"
    );
    const r = withTempAction(yml, (p) => spawnSync(process.execPath, [VALIDATE, p], { encoding: 'utf8' }));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Additional property 'value' is not allowed");
  });
});
