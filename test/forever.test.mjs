// Forever presence: retail's 12.1 removals do not all apply to the Forever client, so a
// Forever-only addon must not be told a symbol is gone when it is sitting in the client.

import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lint } from '../src/index.mjs';
import { isForeverInterface, isForeverOnly } from '../src/toc.mjs';
import { foreverHas, FOREVER_CLIENT } from '../src/forever.mjs';
import { REMOVED_CALLS } from '../src/rules.mjs';
import { buildPresence } from '../scripts/forever-presence.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const idsAt = (result) => result.findings.map((f) => `${f.ruleId}@${f.line}`);

describe('interface classification', () => {
  it('treats 1.60 to 1.99 as Forever and nothing else', () => {
    expect(isForeverInterface(16001)).toBe(true);
    expect(isForeverInterface(19999)).toBe(true);
    expect(isForeverInterface(11509)).toBe(false); // Classic Era
    expect(isForeverInterface(120105)).toBe(false); // retail
    expect(isForeverInterface(50504)).toBe(false); // Mists
  });

  it('is Forever-only when every declared id is a Forever one', () => {
    expect(isForeverOnly([16001])).toBe(true);
    expect(isForeverOnly(['16001'])).toBe(true);
    expect(isForeverOnly([120100, 16001])).toBe(false);
    expect(isForeverOnly([11509, 16001])).toBe(false);
    expect(isForeverOnly([])).toBe(false);
  });
});

describe('presence data', () => {
  it('came from a Forever client', () => {
    expect(FOREVER_CLIENT.interface).toBe(16001);
    expect(FOREVER_CLIENT.build).toBeTruthy();
  });

  it('resolves bare globals and dotted namespace members alike', () => {
    expect(foreverHas('GetWeaponEnchantInfo')).toBe(true);
    expect(foreverHas('C_DyeColor.GetDyeColorForItem')).toBe(true);
    expect(foreverHas('C_Spell')).toBe(true);
    expect(foreverHas('NoSuchFunctionAnywhere')).toBe(false);
  });

  it('disagrees with retail on part of the removal list, which is the whole point', () => {
    const names = Object.keys(REMOVED_CALLS);
    const present = names.filter(foreverHas);
    expect(present.length).toBeGreaterThan(0);
    expect(present.length).toBeLessThan(names.length);
    // The combat-log and aura removals are genuine on both clients.
    expect(foreverHas('UIParentLoadAddOn')).toBe(false);
  });

  it('rejects a scan that is not one', () => {
    expect(() => buildPresence({})).toThrow(/no functions array/);
  });

  it('sorts and dedupes so a rebuild is byte-stable', () => {
    const a = buildPresence(
      { functions: ['B', 'A', 'A'], namespaces: { C_Z: ['b', 'a'], C_A: ['x'] }, client: null },
      { generated: 'fixed' }
    );
    expect(a.globals).toEqual(['A', 'B']);
    expect(Object.keys(a.namespaces)).toEqual(['C_A', 'C_Z']);
    expect(a.namespaces.C_Z).toEqual(['a', 'b']);
    expect(a.globalCount).toBe(2);
    expect(a.memberCount).toBe(3);
  });
});

describe('linting a Forever-only addon', () => {
  it('reports only the removals Forever actually shares', async () => {
    const result = await lint('test/fixtures/forever-only', { cwd: ROOT });
    expect(result.flavour).toBe('forever');
    // GetWeaponEnchantInfo, GetInventorySlotInfo and getglobal all still exist on Forever;
    // UIParentLoadAddOn on line 7 does not.
    expect(idsAt(result)).toEqual(['WSL014@7']);
  });

  it('keeps reporting them when the same file also loads on retail', async () => {
    const result = await lint('test/fixtures/forever-multi', { cwd: ROOT });
    expect(result.flavour).toBe('retail');
    expect(idsAt(result)).toEqual(['WSL014@1', 'WSL014@2']);
  });
});
