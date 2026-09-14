#!/usr/bin/env node
// Used by .github/workflows/refresh-snapshot.yml after --refresh regenerates the snapshot,
// to decide whether the rebuild deserves a pull request. Two reasons it does not:
//
// 1. The snapshot's `generated` field is a fresh ISO timestamp on every run, so a byte diff
//    against the committed file is never empty even when nothing about the actual API data
//    changed. Left unchecked, that means the weekly workflow opens a new pull request every
//    single week forever.
// 2. The mirror tags a patch before it moves `live` onto it, so the vendored snapshot can
//    sit ahead of `live`. Refreshing from `live` then replaces a newer documented surface
//    with an older one, which is a downgrade however new the client build stamp is.
//
// Either way it reverts the working tree, so create-pull-request sees a clean diff and
// correctly opens nothing.

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Drop fields that change on every run regardless of whether the API data did. */
export function stripVolatile(snapshot) {
  const { generated, files, ...rest } = snapshot;
  return rest;
}

export function sameContent(a, b) {
  return JSON.stringify(stripVolatile(a)) === JSON.stringify(stripVolatile(b));
}

/**
 * Order two dotted patch strings ("12.1.5") the way Blizzard numbers them, -1/0/1.
 * A missing or unparseable patch sorts below every real one, so a refresh that could not
 * read the mirror's build stamp is treated as a downgrade and reverted rather than trusted.
 */
export function comparePatch(a, b) {
  const parts = (v) =>
    String(v ?? '')
      .split('.')
      .map(Number)
      .filter(Number.isFinite);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

/** Revert `path` (relative to `cwd`) unless the refresh is both newer and functionally different. */
export function guardRefresh(path, cwd = process.cwd()) {
  const committed = JSON.parse(execSync(`git show HEAD:${path}`, { encoding: 'utf8', cwd, maxBuffer: 1 << 28 }));
  const current = JSON.parse(readFileSync(`${cwd}/${path}`, 'utf8'));
  const result = { patch: current.patch ?? null, committedPatch: committed.patch ?? null };

  // Checked before sameContent: a downgrade to a build that happens to document an identical
  // surface is still a downgrade, and both answers are "revert" anyway.
  if (comparePatch(current.patch, committed.patch) < 0) {
    execSync(`git checkout -- ${path}`, { cwd });
    return { ...result, reverted: true, reason: 'older-patch' };
  }
  if (sameContent(committed, current)) {
    execSync(`git checkout -- ${path}`, { cwd });
    return { ...result, reverted: true, reason: 'unchanged' };
  }
  return { ...result, reverted: false, reason: null };
}

// CLI entry point. `scripts/guard-refresh.mjs [path]`, defaulting to the real snapshot.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2] ?? 'data/api-snapshot.json';
  const { reason, patch, committedPatch } = guardRefresh(path);
  if (reason === 'older-patch') {
    console.log(
      `refresh is patch ${patch ?? 'unknown'}, behind the vendored ${committedPatch}; ` +
        'reverting until the ref catches up'
    );
  } else if (reason === 'unchanged') {
    console.log('snapshot content unchanged (only the generated timestamp differs); reverting');
  } else {
    console.log(`snapshot content changed at patch ${patch ?? 'unknown'}; leaving the refresh in place`);
  }
}
