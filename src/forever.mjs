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

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PRESENCE_PATH = join(HERE, '..', 'data', 'forever-presence.json');

const presence = JSON.parse(readFileSync(PRESENCE_PATH, 'utf8'));

/** The client the scan came from, for reporting which build a suppression rests on. */
export const FOREVER_CLIENT = presence.client;
export const FOREVER_SOURCE = presence.source;

const symbols = new Set(presence.globals);
for (const [namespace, members] of Object.entries(presence.namespaces)) {
  symbols.add(namespace);
  for (const member of members) symbols.add(`${namespace}.${member}`);
}

/**
 * True when `name` exists on the Forever client. Takes the same dotted key space the rules
 * use, so both `GetWeaponEnchantInfo` and `C_DyeColor.GetDyeColorForItem` resolve.
 */
export function foreverHas(name) {
  return symbols.has(name);
}
