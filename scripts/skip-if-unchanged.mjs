#!/usr/bin/env node
// Used by .github/workflows/refresh-snapshot.yml after --refresh regenerates the snapshot.
//
// The snapshot's `generated` field is a fresh ISO timestamp on every run, so a byte diff
// against the committed file is never empty even when nothing about the actual API data
// changed. Left unchecked, that means the weekly workflow opens a new pull request every
// single week forever. This compares the two snapshots ignoring `generated`/`files`, and
// if the functional content is identical, reverts the working tree so create-pull-request
// sees a clean diff and correctly opens nothing.

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

/** Revert `path` (relative to `cwd`) if only its volatile fields changed since HEAD. */
export function skipIfUnchanged(path, cwd = process.cwd()) {
  const committed = JSON.parse(execSync(`git show HEAD:${path}`, { encoding: 'utf8', cwd, maxBuffer: 1 << 28 }));
  const current = JSON.parse(readFileSync(`${cwd}/${path}`, 'utf8'));

  if (sameContent(committed, current)) {
    execSync(`git checkout -- ${path}`, { cwd });
    return { reverted: true };
  }
  return { reverted: false };
}

// CLI entry point. `scripts/skip-if-unchanged.mjs [path]`, defaulting to the real snapshot.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2] ?? 'data/api-snapshot.json';
  const { reverted } = skipIfUnchanged(path);
  console.log(
    reverted
      ? 'snapshot content unchanged (only the generated timestamp differs); reverting'
      : 'snapshot content changed; leaving the refresh in place'
  );
}
