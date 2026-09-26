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
//    with an older one, which is a downgrade however new the client build stamp is. The
//    same goes for an earlier build of the same patch.
//
// Either way it reverts the working tree, so create-pull-request sees a clean diff and
// correctly opens nothing.

import { execSync } from 'node:child_process';
import { readFileSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Drop the fields that describe the rebuild rather than the API: the timestamp changes every
 * run, and the mirror ref and commit change when `live` reaches a build the tag already had.
 */
export function stripVolatile(snapshot) {
  const { generated, files, ref, commit, source, ...rest } = snapshot;
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

/** A build stamp to order by; a missing one sorts below every real build. */
const buildOf = (snapshot) => (Number.isFinite(snapshot.build) ? snapshot.build : -Infinity);

/**
 * Revert `path` (relative to `cwd`) unless the refresh is both newer and functionally different.
 * It is judged against the committed file, or against `against`, a copy taken just before this
 * refresh, which lets a second refresh in the same run build on a first one that was kept.
 */
export function guardRefresh(path, cwd = process.cwd(), against = null) {
  const baseline = against
    ? readFileSync(resolve(cwd, against), 'utf8')
    : execSync(`git show HEAD:${path}`, { encoding: 'utf8', cwd, maxBuffer: 1 << 28 });
  const committed = JSON.parse(baseline);
  const current = JSON.parse(readFileSync(resolve(cwd, path), 'utf8'));
  const result = {
    patch: current.patch ?? null,
    build: current.build ?? null,
    committedPatch: committed.patch ?? null,
    committedBuild: committed.build ?? null,
  };
  const revert = (reason) => {
    if (against) copyFileSync(resolve(cwd, against), resolve(cwd, path));
    else execSync(`git checkout -- ${path}`, { cwd });
    return { ...result, reverted: true, reason };
  };

  // Checked before sameContent: a downgrade to a build that happens to document an identical
  // surface is still a downgrade, and both answers are "revert" anyway.
  const byPatch = comparePatch(current.patch, committed.patch);
  if (byPatch < 0) return revert('older-patch');
  if (byPatch === 0 && buildOf(current) < buildOf(committed)) return revert('older-build');
  if (sameContent(committed, current)) return revert('unchanged');
  return { ...result, reverted: false, reason: null };
}

// CLI entry point. `scripts/guard-refresh.mjs [path] [--against=<copy>]`, defaulting to the
// real snapshot judged against HEAD.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let path = 'data/api-snapshot.json';
  let against = null;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--against') against = args[++i];
    else if (args[i].startsWith('--against=')) against = args[i].slice('--against='.length);
    else path = args[i];
  }
  const { reason, patch, build, committedPatch, committedBuild } = guardRefresh(path, process.cwd(), against);
  if (reason === 'older-patch') {
    console.log(
      `refresh is patch ${patch ?? 'unknown'}, behind the vendored ${committedPatch}; ` +
        'reverting until the ref catches up'
    );
  } else if (reason === 'older-build') {
    console.log(`refresh is ${patch} build ${build ?? 'unknown'}, behind the vendored build ${committedBuild}; reverting`);
  } else if (reason === 'unchanged') {
    console.log('snapshot API content unchanged; reverting');
  } else {
    console.log(`snapshot content changed at patch ${patch ?? 'unknown'}; leaving the refresh in place`);
  }
}
