import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripVolatile, sameContent, comparePatch, guardRefresh } from '../scripts/guard-refresh.mjs';

// scripts/guard-refresh.mjs is CI glue for .github/workflows/refresh-snapshot.yml. It drops a
// refresh on two counts. The snapshot's `generated` timestamp changes on every --refresh even
// when the underlying API data does not, so an unguarded commit would open a new no-op pull
// request every week forever (this happened for real on 2026-08-24, PR #1). And the mirror
// tags a patch before it moves `live`, so a refresh from `live` can walk the vendored snapshot
// backwards a patch (this happened for real on 2026-09-14: live was 12.1.0 build 69814 while
// the vendored snapshot was 12.1.5 build 69594, and the whole 12.1.5 rule suite went red).
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

describe('comparePatch', () => {
  it('orders by segment, not by string', () => {
    expect(comparePatch('12.1.0', '12.1.5')).toBe(-1);
    expect(comparePatch('12.1.5', '12.1.0')).toBe(1);
    expect(comparePatch('12.10.0', '12.9.0')).toBe(1);
    expect(comparePatch('12.1.5', '12.1.5')).toBe(0);
  });

  it('pads a shorter version with zeros', () => {
    expect(comparePatch('12.1', '12.1.0')).toBe(0);
    expect(comparePatch('12.1', '12.1.5')).toBe(-1);
    expect(comparePatch('12.2', '12.1.5')).toBe(1);
  });

  it('sorts a missing or unreadable patch below every real one', () => {
    expect(comparePatch(null, '12.1.5')).toBe(-1);
    expect(comparePatch(undefined, '12.1.5')).toBe(-1);
    expect(comparePatch('', '12.1.5')).toBe(-1);
    expect(comparePatch(null, null)).toBe(0);
    expect(comparePatch('12.1.5', null)).toBe(1);
  });
});

describe('guardRefresh, against a real throwaway git repo', () => {
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

    const result = guardRefresh('snap.json', dir);
    expect(result.reverted).toBe(true);
    expect(result.reason).toBe('unchanged');
    expect(run('git diff --stat snap.json').toString()).toBe('');
    rmSync(dir, { recursive: true, force: true });
  });

  it('leaves a genuine functional change in place', () => {
    const { dir, run } = makeRepo();
    writeFileSync(join(dir, 'snap.json'), JSON.stringify({ generated: 'old', functionCount: 5 }));
    run('git add snap.json');
    run('git commit -q -m init');

    writeFileSync(join(dir, 'snap.json'), JSON.stringify({ generated: 'new', functionCount: 6 }));
    const result = guardRefresh('snap.json', dir);
    expect(result.reverted).toBe(false);
    expect(result.reason).toBe(null);
    expect(run('git diff --stat snap.json').toString()).not.toBe('');
    rmSync(dir, { recursive: true, force: true });
  });

  it('is a no-op on an already-clean tree', () => {
    const { dir, run } = makeRepo();
    writeFileSync(join(dir, 'snap.json'), JSON.stringify({ generated: 'old', functionCount: 5 }));
    run('git add snap.json');
    run('git commit -q -m init');

    const result = guardRefresh('snap.json', dir);
    expect(result.reverted).toBe(true);
    expect(run('git diff --stat snap.json').toString()).toBe('');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('the downgrade guard, against a real throwaway git repo', () => {
  function commitSnapshot(snapshot) {
    const dir = mkdtempSync(join(tmpdir(), 'wsl-guard-'));
    const run = (cmd) => execSync(cmd, { cwd: dir, stdio: 'pipe' });
    run('git init -q');
    run('git config user.email test@example.com');
    run('git config user.name test');
    writeFileSync(join(dir, 'snap.json'), JSON.stringify(snapshot));
    run('git add snap.json');
    run('git commit -q -m init');
    return { dir, run };
  }

  // The 2026-09-14 failure exactly: `live` was a later 12.1.0 build than the 12.1.5 tag we
  // vendored from, so the content genuinely differed and the old guard kept it.
  it('reverts a newer build of an older patch', () => {
    const { dir, run } = commitSnapshot({ generated: 'old', patch: '12.1.5', build: 69594, functionCount: 10101 });
    writeFileSync(
      join(dir, 'snap.json'),
      JSON.stringify({ generated: 'new', patch: '12.1.0', build: 69814, functionCount: 10080 })
    );

    const result = guardRefresh('snap.json', dir);
    expect(result).toMatchObject({ reverted: true, reason: 'older-patch', patch: '12.1.0', committedPatch: '12.1.5' });
    expect(run('git diff --stat snap.json').toString()).toBe('');
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps the refresh once the ref catches up to the vendored patch', () => {
    const { dir, run } = commitSnapshot({ generated: 'old', patch: '12.1.5', build: 69594, functionCount: 10101 });
    writeFileSync(
      join(dir, 'snap.json'),
      JSON.stringify({ generated: 'new', patch: '12.1.5', build: 69900, functionCount: 10105 })
    );

    const result = guardRefresh('snap.json', dir);
    expect(result).toMatchObject({ reverted: false, reason: null });
    expect(run('git diff --stat snap.json').toString()).not.toBe('');
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps the refresh on a newer patch', () => {
    const { dir, run } = commitSnapshot({ generated: 'old', patch: '12.1.5', build: 69594, functionCount: 10101 });
    writeFileSync(
      join(dir, 'snap.json'),
      JSON.stringify({ generated: 'new', patch: '12.2.0', build: 70100, functionCount: 10300 })
    );

    const result = guardRefresh('snap.json', dir);
    expect(result).toMatchObject({ reverted: false, reason: null });
    expect(run('git diff --stat snap.json').toString()).not.toBe('');
    rmSync(dir, { recursive: true, force: true });
  });

  // --refresh writes the build stamp from the mirror's head commit message and tolerates a
  // failure to read it. A snapshot that cannot say what it is must not replace one that can.
  it('reverts a refresh that lost its build stamp', () => {
    const { dir, run } = commitSnapshot({ generated: 'old', patch: '12.1.5', build: 69594, functionCount: 10101 });
    writeFileSync(
      join(dir, 'snap.json'),
      JSON.stringify({ generated: 'new', patch: null, build: null, functionCount: 10101 })
    );

    const result = guardRefresh('snap.json', dir);
    expect(result).toMatchObject({ reverted: true, reason: 'older-patch' });
    expect(run('git diff --stat snap.json').toString()).toBe('');
    rmSync(dir, { recursive: true, force: true });
  });
});
