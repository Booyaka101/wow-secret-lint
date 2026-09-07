// Widget typing across files: a frame one file creates is known to every file after it in
// .toc load order, through globals and through the addon's private table.

import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeSource } from '../src/analyze.mjs';
import { loadSnapshot } from '../src/apidata.mjs';
import { lint } from '../src/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const BIN = join(ROOT, 'bin', 'wow-secret-lint.mjs');
const ADDON = join('test', 'fixtures', 'cross-file');

let api;
beforeAll(async () => {
  api = await loadSnapshot();
});

function run(args, cwd = ROOT) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('exports', () => {
  it('exports globals, _G assignments and the private table, never plain locals', () => {
    const src =
      'local ADDON, ns = ...\n' +
      'ns.container = CreateFrame("AuraContainer")\n' +
      'MyGlobalButton = CreateFrame("AuraButton")\n' +
      '_G["ByString"] = CreateFrame("AuraButton")\n' +
      'local mine = CreateFrame("AuraButton")\n' +
      'local function f(param) param = CreateFrame("AuraButton") end\n';
    const { exports } = analyzeSource(src, 'x.lua', api);
    expect(new Map(exports)).toEqual(
      new Map([
        ['<ns>.container', 'AuraContainer'],
        ['MyGlobalButton', 'AuraButton'],
        ['ByString', 'AuraButton'],
      ])
    );
  });

  it('recognises both spellings of the private table', () => {
    for (const decl of ['local _, ns = ...', 'local ns = select(2, ...)']) {
      const { exports } = analyzeSource(`${decl}\nns.c = CreateFrame("AuraContainer")\n`, 'x.lua', api);
      expect(exports).toEqual([['<ns>.c', 'AuraContainer']]);
    }
  });

  it('exports nothing under --patch=12.0, where widget typing is off', () => {
    const { exports } = analyzeSource('Glob = CreateFrame("AuraButton")\n', 'x.lua', api, { patch: '12.0' });
    expect(exports).toEqual([]);
  });
});

describe('imports', () => {
  const imports = [
    ['<ns>.container', 'AuraContainer'],
    ['Glob', 'AuraButton'],
  ];

  it('binds <ns> to whatever this file calls the private table', () => {
    const src = 'local _, private = ...\nprivate.container:RegisterEvent("UNIT_AURA")\nGlob:SetScript("OnShow", nil)\n';
    const { findings } = analyzeSource(src, 'x.lua', api, { imports });
    expect(findings.map((f) => `${f.ruleId}@${f.line}`)).toEqual(['WSL017@2', 'WSL017@3']);
  });

  it('ignores <ns> entries in a file with no private table, and lets a local shadow a global', () => {
    const src = 'local Glob = CreateFrame("Button")\nGlob:SetScript("OnShow", nil)\nlocal ns = {}\nns.container = {}\nns.container:RegisterEvent("X")\n';
    const { findings } = analyzeSource(src, 'x.lua', api, { imports });
    expect(findings).toEqual([]);
  });
});

describe('the cross-file fixture addon', () => {
  it('reports the uses in later files and nothing in earlier or shadowing ones', async () => {
    const result = await lint(ADDON, { cwd: ROOT });
    expect(result.findings.map((f) => `${f.file.split('/').pop()}:${f.line} ${f.ruleId}`)).toEqual([
      'Buttons.lua:3 WSL017', // ns.container created in Init.lua
      'Buttons.lua:4 WSL017', // global AuraButton created in Init.lua
      'Buttons.lua:5 WSL017', // AuraButton assigned through _G in Init.lua
      'Glow.lua:3 WSL019', // group registered in Buttons.lua, under another name for ns
      'Glow.lua:4 WSL020',
    ]);
  });

  it('is silent under --patch=12.1 for the 12.1.5 rules and under 12.0 for all of them', async () => {
    const r121 = await run(['--patch=12.1', '--format=json', ADDON]);
    expect(JSON.parse(r121.stdout).findings.map((f) => f.ruleId)).toEqual(['WSL017', 'WSL017', 'WSL017']);
    const r120 = await run(['--patch=12.0', ADDON]);
    expect(r120.stdout.trim()).toBe('0 errors, 0 warnings');
  });

  it('does not carry widgets between separate targets on one command line', async () => {
    const r = await run(['--format=json', join(ADDON, 'Init.lua'), join(ADDON, 'Buttons.lua')]);
    expect(JSON.parse(r.stdout).findings).toEqual([]);
  });
});
