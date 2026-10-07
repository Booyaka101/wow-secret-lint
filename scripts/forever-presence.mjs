#!/usr/bin/env node
// Rebuilds data/forever-presence.json from a captured scan of a running WoW Forever client.
//
// The retail snapshot in data/api-snapshot.json comes from Blizzard's generated API
// documentation, which documents the Mainline client. Forever has no equivalent published
// documentation, so presence has to come from a scan of the live client instead. That is a
// weaker source and it is deliberately used for one narrow job: deciding whether a symbol
// retail removed is still there on Forever. It never feeds the secret-value rules, which
// stay on the documented retail surface.
//
// Usage:
//   node scripts/forever-presence.mjs <forever_api.json> [--out data/forever-presence.json]
//
// The input is the shape produced by Thunderz96/forever-addon-kit's tools/api_scan_all.py:
// { client: {...}, functions: [...], namespaces: { C_Foo: ["Bar", ...] }, frames: [...] }.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_OUT = join(HERE, '..', 'data', 'forever-presence.json');

export const SOURCE = 'Thunderz96/forever-addon-kit@data/forever_api.json';
export const SOURCE_LICENSE = 'MIT';

/** Shape a raw client scan into the presence file, dropping everything the rules never ask about. */
export function buildPresence(scan, { generated = new Date().toISOString() } = {}) {
  if (!Array.isArray(scan.functions) || !scan.namespaces) {
    throw new Error('scan has no functions array or namespaces object; wrong input file?');
  }

  const globals = [...new Set(scan.functions)].sort();
  const namespaces = {};
  let memberCount = 0;
  for (const name of Object.keys(scan.namespaces).sort()) {
    const members = [...new Set(scan.namespaces[name])].sort();
    namespaces[name] = members;
    memberCount += members.length;
  }

  return {
    source: scan.source || scan.source_note || SOURCE,
    sourceLicense: scan.source ? 'see source' : SOURCE_LICENSE,
    client: scan.client ?? null,
    generated,
    globalCount: globals.length,
    namespaceCount: Object.keys(namespaces).length,
    memberCount,
    globals,
    namespaces,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const outFlag = args.indexOf('--out');
  const out = outFlag === -1 ? DEFAULT_OUT : resolve(args[outFlag + 1]);
  const outValue = outFlag === -1 ? -1 : outFlag + 1;
  const input = args.find((a, i) => !a.startsWith('--') && i !== outValue);
  if (!input) {
    console.error('usage: node scripts/forever-presence.mjs <forever_api.json> [--out <path>]');
    process.exit(2);
  }
  const presence = buildPresence(JSON.parse(readFileSync(resolve(input), 'utf8')));
  writeFileSync(out, `${JSON.stringify(presence, null, 2)}\n`);
  console.log(
    `wrote ${out}: ${presence.globalCount} globals, ${presence.namespaceCount} namespaces, ` +
      `${presence.memberCount} members (client ${presence.client?.version ?? '?'} build ${presence.client?.build ?? '?'})`
  );
}
