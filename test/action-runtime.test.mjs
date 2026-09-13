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
    // Read the open runtimes out of the table rather than naming node24, and do
    // not use `node26` as the unknown: both would fail here the day GitHub
    // moves, which is what the first test is for.
    // Node runtimes only: composite and docker are not interpreters and never
    // get a removal date, so including them makes the guard below unfailable.
    const open = Object.keys(RUNTIMES).filter((k) => /^node/.test(k) && RUNTIMES[k].removedOn === null);
    expect(open.length).toBeGreaterThan(0);
    for (const k of open) expect(checkRuntime(k).ok, k).toBe(true);
    expect(checkRuntime('nodejs-latest').ok).toBe(false);
    expect(checkRuntime(null).ok).toBe(false);
    expect(checkRuntime('').ok).toBe(false);
  });

  it('reads runs.using past quotes and comments, and ignores a lookalike key', () => {
    expect(withTempAction("runs:\n  using: 'node24'\n  main: x.mjs\n", readUsing)).toBe('node24');
    expect(withTempAction('runs:\n  using: node24 # pinned\n  main: x.mjs\n', readUsing)).toBe('node24');
    // A comment or blank line at column 0 belongs to no block, so it must not
    // end `runs:`. action-validator accepts such a file, and we used to read it
    // as declaring no runtime at all and hard-fail on a valid action.
    expect(withTempAction('runs:\n# note\n\n  using: node24\n  main: x.mjs\n', readUsing)).toBe('node24');
    expect(withTempAction('inputs:\n  using:\n    default: node20\n', readUsing)).toBe(null);
    expect(withTempAction('runs:\n  main: x.mjs\nbranding:\n  using: node20\n', readUsing)).toBe(null);
  });

  it('rewrites runs.using and nothing else', () => {
    const decoy = "inputs:\n  using:\n    default: node20\nruns:\n  using: 'node24'\n  main: 'action/index.mjs'\n";
    const swapped = withRuntime(decoy, 'node20');
    // The decoy input keeps its own default: only the line under `runs:` moves.
    expect(swapped).toContain('    default: node20');
    expect(swapped).toContain("  using: 'node20'");
    expect(withRuntime('name: x', 'node20')).toBe('name: x');
    expect(withRuntime('runs:\n# note\n  using: node24\n', 'node20')).toBe('runs:\n# note\n  using: node20\n');
  });
});

describe('validate:action', () => {
  it('passes action.yml despite the stale runs.using enum', () => {
    const r = spawnSync(process.execPath, [VALIDATE], { encoding: 'utf8' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });

  it('does not narrow a runtime the schema already accepts', () => {
    // `using: composite` with `main:` and no `steps:` is genuinely invalid, and
    // composite is in the 0.6.0 enum. Probing it as node20 makes it validate
    // clean, so the wrapper used to pass it and blame the runtime enum.
    const run = (body) => withTempAction(body, (f) => spawnSync(process.execPath, [VALIDATE, f], { encoding: 'utf8' }));
    const bad = run('name: x\ndescription: y\nruns:\n  using: composite\n  main: dist/index.mjs\n');
    expect(bad.status, bad.stdout + bad.stderr).toBe(1);

    // And what it reports is the file's own error, not the oneOf spray the probe
    // produces by rewriting a valid composite action into a node20 one.
    const noisy = run([
      'bogus-top-level: 1', 'name: x', 'description: y', 'runs:', '  using: composite',
      '  steps:', '    - run: echo hi', '      shell: bash', '',
    ].join('\n'));
    expect(noisy.status).toBe(1);
    expect(noisy.stderr).toContain('bogus-top-level');
    expect(noisy.stderr).not.toContain('one_of');
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
