import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripVolatile, sameContent, skipIfUnchanged } from '../scripts/skip-if-unchanged.mjs';

// scripts/skip-if-unchanged.mjs is CI glue for .github/workflows/refresh-snapshot.yml: the
// snapshot's `generated` timestamp changes on every --refresh even when the underlying API
// data does not, so an unguarded commit would open a new no-op pull request every week
// forever (this happened for real on 2026-08-24, PR #1).
//
// Exercised against a throwaway git repo, never the real tracked snapshot, because vitest
// runs test files in parallel and other files read data/api-snapshot.json concurrently.

describe('pure comparison', () => {
  it('ignores generated and files, compares everything else', () => {
    const a = { generated: 't1', files: 612, functionCount: 10098, functions: { X: 1 } };
    const b = { generated: 't2', files: 613, functionCount: 10098, functions: { X: 1 } };
    expect(sameContent(a, b)).toBe(true);
  });

  it('catches a real content difference', () => {
    const a = { generated: 't1', functionCount: 10098 };
    const b = { generated: 't2', functionCount: 10099 };
    expect(sameContent(a, b)).toBe(false);
  });

  it('strips exactly generated and files, nothing else', () => {
    const stripped = stripVolatile({ generated: 't', files: 1, keep: 'me' });
    expect(stripped).toEqual({ keep: 'me' });
  });
});

describe('skipIfUnchanged, against a real throwaway git repo', () => {
  function makeRepo() {
    const dir = mkdtempSync(join(tmpdir(), 'wsl-skip-'));
    const run = (cmd) => execSync(cmd, { cwd: dir, stdio: 'pipe' });
    run('git init -q');
    run('git config user.email test@example.com');
    run('git config user.name test');
    return { dir, run };
  }

  it('reverts the file when only the timestamp differs from HEAD', () => {
    const { dir, run } = makeRepo();
    writeFileSync(join(dir, 'snap.json'), JSON.stringify({ generated: 'old', functionCount: 5 }));
    run('git add snap.json');
    run('git commit -q -m init');

    writeFileSync(join(dir, 'snap.json'), JSON.stringify({ generated: 'new', functionCount: 5 }));
    const before = run('git diff --stat snap.json').toString();
    expect(before).not.toBe('');

    const result = skipIfUnchanged('snap.json', dir);
    expect(result.reverted).toBe(true);
    expect(run('git diff --stat snap.json').toString()).toBe('');
    rmSync(dir, { recursive: true, force: true });
  });

  it('leaves a genuine functional change in place', () => {
    const { dir, run } = makeRepo();
    writeFileSync(join(dir, 'snap.json'), JSON.stringify({ generated: 'old', functionCount: 5 }));
    run('git add snap.json');
    run('git commit -q -m init');

    writeFileSync(join(dir, 'snap.json'), JSON.stringify({ generated: 'new', functionCount: 6 }));
    const result = skipIfUnchanged('snap.json', dir);
    expect(result.reverted).toBe(false);
    expect(run('git diff --stat snap.json').toString()).not.toBe('');
    rmSync(dir, { recursive: true, force: true });
  });

  it('is a no-op on an already-clean tree', () => {
    const { dir, run } = makeRepo();
    writeFileSync(join(dir, 'snap.json'), JSON.stringify({ generated: 'old', functionCount: 5 }));
    run('git add snap.json');
    run('git commit -q -m init');

    const result = skipIfUnchanged('snap.json', dir);
    expect(result.reverted).toBe(true);
    expect(run('git diff --stat snap.json').toString()).toBe('');
    rmSync(dir, { recursive: true, force: true });
  });
});
