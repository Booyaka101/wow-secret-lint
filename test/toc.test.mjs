import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseToc, resolveTocFiles, findTocFiles, findTocFilesDeep, isClassicToc, isRetailToc } from '../src/toc.mjs';
import { lint } from '../src/index.mjs';

async function fixture(files) {
  const dir = await mkdtemp(join(tmpdir(), 'wsl-toc-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(join(abs, '..'), { recursive: true });
    await writeFile(abs, body, 'utf8');
  }
  return dir;
}

describe('toc parsing', () => {
  it('reads metadata, keeps load order, and normalises backslashes', async () => {
    const dir = await fixture({
      'A.toc': '## Interface: 120001, 120005\n## Title: A\n\n# a comment\nCore\\First.lua\nCore\\Second.lua\nBindings.xml\n',
      'Core/First.lua': '',
      'Core/Second.lua': '',
    });
    const toc = await parseToc(join(dir, 'A.toc'));
    expect(toc.metadata.Title).toBe('A');
    expect(toc.interface).toEqual(['120001', '120005']);
    expect(toc.files).toEqual(['Core/First.lua', 'Core/Second.lua']);
    expect(toc.other).toEqual(['Bindings.xml']);
    await rm(dir, { recursive: true, force: true });
  });

  it('strips a trailing load directive and skips locale placeholders', async () => {
    const dir = await fixture({
      'A.toc': 'Core/Real.lua [AllowLoad Game]\nLocales\\[TextLocale].lua [AllowLoadTextLocale deDE, frFR]\n',
      'Core/Real.lua': '',
    });
    const toc = await parseToc(join(dir, 'A.toc'));
    expect(toc.files).toEqual(['Core/Real.lua']);
    const { resolved, missing } = await resolveTocFiles(toc);
    expect(resolved).toHaveLength(1);
    expect(missing).toEqual([]);
    await rm(dir, { recursive: true, force: true });
  });

  it('follows Script and Include entries in a listed xml', async () => {
    const dir = await fixture({
      'A.toc': '## Title: A\n\nA.xml\n',
      'A.xml': '<Ui>\n<Include file="elements\\elements.xml"/>\n<Script file="init.lua"/>\n</Ui>\n',
      'elements/elements.xml': "<Ui><Script file='health.lua'/></Ui>\n",
      'init.lua': '',
      'elements/health.lua': '',
    });
    const toc = await parseToc(join(dir, 'A.toc'));
    const { resolved, missing } = await resolveTocFiles(toc);
    expect(resolved.map((f) => f.relative).sort()).toEqual(['elements/health.lua', 'init.lua']);
    expect(missing).toEqual([]);
    await rm(dir, { recursive: true, force: true });
  });

  it('reports a listed file that is not on disk without dropping the rest', async () => {
    const dir = await fixture({ 'A.toc': 'There.lua\nGone.lua\n', 'There.lua': 'local hp = UnitHealth("p")\nlocal x = hp * 2\n' });
    const result = await lint(dir, { cwd: dir });
    expect(result.warningsBeforeLint.some((w) => w.includes('Gone.lua'))).toBe(true);
    expect(result.findings.map((f) => f.ruleId)).toEqual(['WSL001']);
    await rm(dir, { recursive: true, force: true });
  });

  it('skips classic-flavour toc files when scanning a directory', async () => {
    expect(isClassicToc('/x/Addon_Vanilla.toc')).toBe(true);
    expect(isClassicToc('/x/Addon_Mists.toc')).toBe(true);
    expect(isClassicToc('/x/Addon_Mainline.toc')).toBe(false);
    expect(isClassicToc('/x/Addon.toc')).toBe(false);
  });

  it('falls back to walking for .lua when a directory has no toc', async () => {
    const dir = await fixture({ 'sub/x.lua': 'local hp = UnitHealth("p")\nlocal y = #hp\n' });
    const result = await lint(dir, { cwd: dir });
    expect(result.filesScanned).toBe(1);
    expect(result.findings.map((f) => f.ruleId)).toEqual(['WSL004']);
    await rm(dir, { recursive: true, force: true });
  });

  it('warns rather than throwing on a directory with nothing to lint', async () => {
    const dir = await fixture({ 'notes.md': 'hello' });
    const result = await lint(dir, { cwd: dir });
    expect(result.filesScanned).toBe(0);
    expect(result.warningsBeforeLint.join(' ')).toMatch(/no \.toc and no \.lua files/);
    await rm(dir, { recursive: true, force: true });
  });

  it('gives a clear error for a directory that does not exist', async () => {
    await expect(findTocFiles(join(tmpdir(), 'wsl-definitely-not-here'))).rejects.toThrow(/no such directory/);
  });

  it('accepts WoW Lua that puts a semicolon after break', async () => {
    const dir = await fixture({
      'x.lua': 'for i = 1, 3 do\n\tif i == 2 then\n\t\tbreak;\n\tend\nend\nlocal hp = UnitHealth("p")\nlocal v = hp + 1\n',
    });
    const result = await lint(dir, { cwd: dir });
    expect(result.parseErrors).toEqual([]);
    expect(result.findings.map((f) => f.ruleId)).toEqual(['WSL001']);
    await rm(dir, { recursive: true, force: true });
  });
});

describe('flavour-aware discovery', () => {
  const BAD = `local hp = UnitHealth("p")
local x = hp * 2
`;
  const toc = (iface, file) => `## Interface: ${iface}

${file}
`;

  it('classifies retail and Classic toc files by Interface id', async () => {
    const dir = await fixture({
      'R.toc': toc('120100', 'a.lua'),
      'C.toc': toc('40402', 'a.lua'),
      'M.toc': toc('120100, 50504, 11509', 'a.lua'),
      'T.toc': toc('@toc-version-retail@', 'a.lua'),
      'a.lua': '',
    });
    const get = async (n) => isRetailToc(await parseToc(join(dir, n)));
    expect(await get('R.toc')).toBe(true);
    expect(await get('C.toc')).toBe(false);
    expect(await get('M.toc')).toBe(true);
    expect(await get('T.toc')).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });

  it('finds a toc nested below the scanned directory', async () => {
    const dir = await fixture({ 'MyAddon/MyAddon.toc': toc('120100', 'Core.lua'), 'MyAddon/Core.lua': BAD });
    expect((await findTocFilesDeep(dir)).length).toBe(1);
    const r = await lint(dir, { cwd: dir });
    expect(r.filesScanned).toBe(1);
    expect(r.findings.map((f) => f.ruleId)).toEqual(['WSL001']);
    await rm(dir, { recursive: true, force: true });
  });

  it('scans nothing when every nested toc targets Classic', async () => {
    const dir = await fixture({
      'WA/WA_Cata.toc': toc('40402', 'Core.lua'),
      'WA/WA_Vanilla.toc': toc('11509', 'Core.lua'),
      'WA/Core.lua': BAD,
    });
    const r = await lint(dir, { cwd: dir });
    expect(r.filesScanned).toBe(0);
    expect(r.findings).toEqual([]);
    expect(r.warningsBeforeLint.join(' ')).toMatch(/none targeting retail/);
    await rm(dir, { recursive: true, force: true });
  });

  it('says so out loud when it falls back to walking every lua', async () => {
    const dir = await fixture({ 'sub/x.lua': BAD });
    const r = await lint(dir, { cwd: dir });
    expect(r.filesScanned).toBe(1);
    expect(r.warningsBeforeLint.join(' ')).toMatch(/no [.]toc found, scanning every [.]lua/);
    await rm(dir, { recursive: true, force: true });
  });

  it('prefers a toc at the top level over descending', async () => {
    const dir = await fixture({
      'Top.toc': toc('120100', 'Top.lua'),
      'Top.lua': BAD,
      'nested/Deep.toc': toc('120100', 'Deep.lua'),
      'nested/Deep.lua': BAD,
    });
    const r = await lint(dir, { cwd: dir });
    expect(r.filesScanned).toBe(1);
    await rm(dir, { recursive: true, force: true });
  });
});
