// Which symbols exist on the WoW Forever client.
//
// Forever runs the modern client and has secret values, so every secret rule here applies to
// it unchanged and keeps using the documented retail surface. What it did not inherit is
// retail's *removals*: it branched from a different base, so a global the 12.1 notes list as
// removed can still be present. Checking a Forever-only addon against retail's removal list
// therefore reports symbols that are sitting right there in the client.
//
// This file answers only that one question. It is a client scan rather than generated
// documentation, so it carries no type or secrecy information and is never consulted for
// anything but presence. See scripts/forever-presence.mjs for how the data is rebuilt.
//
// The scan is taken at login, and the modern client demand-loads many C_* namespace tables
// only when their UI opens (measured on retail 12.1.0: roughly half the documented surface
// is absent from a bare-login _G snapshot). Absence here is therefore authoritative only for
// base-loaded symbols — which is exactly what REMOVED_CALLS contains — and must not be read
// as "the client lacks this" for lazy-loaded namespaces.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PRESENCE_PATH = join(HERE, '..', 'data', 'forever-presence.json');

// Parsed on first use, like the api snapshot: retail-only runs never read the file, and a
// missing or corrupt presence file fails Forever suppression instead of the whole linter.
let symbols = null;
let client = null;
let source = null;

function load() {
  if (symbols) return;
  const presence = JSON.parse(readFileSync(PRESENCE_PATH, 'utf8'));
  client = presence.client;
  source = presence.source;
  symbols = new Set(presence.globals);
  for (const [namespace, members] of Object.entries(presence.namespaces)) {
    symbols.add(namespace);
    for (const member of members) symbols.add(`${namespace}.${member}`);
  }
}

/** The client the scan came from, for reporting which build a suppression rests on. */
export function foreverClient() {
  load();
  return client;
}

/** Where the presence scan came from. */
export function foreverSource() {
  load();
  return source;
}

/**
 * True when `name` exists on the Forever client. Takes the same dotted key space the rules
 * use, so both `GetWeaponEnchantInfo` and `C_DyeColor.GetDyeColorForItem` resolve.
 */
export function foreverHas(name) {
  load();
  return symbols.has(name);
}
