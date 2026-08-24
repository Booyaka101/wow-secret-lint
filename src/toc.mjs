// Reads an addon .toc and returns the Lua files it loads, in load order.
//
// .toc files list one path per line, use Windows separators, and may carry `## Key: value`
// metadata plus `#` comments. Retail also supports `#@`-style packager directives, which we
// treat as comments.

import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep, posix } from 'node:path';

/** Find .toc files in a directory. Returns absolute paths. */
export async function findTocFiles(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    throw new Error(`cannot read directory ${dir}: ${err.code === 'ENOENT' ? 'no such directory' : err.message}`);
  }
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.toc'))
    .map((e) => join(dir, e.name))
    .sort();
}

/** True for a .toc that targets a non-retail flavour, which has no secret values. */
export function isClassicToc(tocPath) {
  const name = basename(tocPath, '.toc');
  return /_(Vanilla|TBC|Wrath|Cata|Mists|Classic)$/i.test(name);
}

function normalise(entry) {
  return entry.split('\\').join('/');
}

/**
 * Parse a .toc file.
 * @returns {{ path, metadata, files: string[], interface: string[] }}
 *   `files` are addon-relative POSIX paths, in load order, for .lua entries only.
 */
export async function parseToc(tocPath) {
  let text;
  try {
    text = await readFile(tocPath, 'utf8');
  } catch (err) {
    throw new Error(`cannot read ${tocPath}: ${err.code === 'ENOENT' ? 'no such file' : err.message}`);
  }
  const metadata = {};
  const files = [];
  const other = [];
  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('##')) {
      const m = /^##\s*([^:]+):\s*(.*)$/.exec(line);
      if (m) metadata[m[1].trim()] = m[2].trim();
      continue;
    }
    if (line.startsWith('#')) continue; // comment or packager directive
    // Retail allows a trailing load directive, e.g. `Locales\[TextLocale].lua [AllowLoad ...]`.
    const entry = normalise(line.replace(/\s*\[[^\]]*\]\s*$/, '').trim());
    if (!entry) continue;
    // `[TextLocale]`-style placeholders are expanded by the client, not by us.
    if (entry.includes('[') || entry.includes(']')) continue;
    if (/\.lua$/i.test(entry)) files.push(entry);
    else other.push(entry);
  }
  const iface = (metadata.Interface || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return { path: tocPath, metadata, files, other, interface: iface };
}

const SCRIPT_TAG = /<\s*(Script|Include)\b[^>]*\bfile\s*=\s*(["'])([^"']+)\2/gi;

/**
 * Real addons commonly load their Lua from an .xml listed in the .toc (oUF, LittleWigs).
 * Follow <Script file="..."/> and <Include file="..."/> so those files are not skipped.
 */
async function expandXml(absXml, seen, out, missing, label) {
  if (seen.has(absXml)) return;
  seen.add(absXml);
  let text;
  try {
    text = await readFile(absXml, 'utf8');
  } catch {
    missing.push(label);
    return;
  }
  const dir = dirname(absXml);
  SCRIPT_TAG.lastIndex = 0;
  let m;
  while ((m = SCRIPT_TAG.exec(text)) !== null) {
    const rel = normalise(m[3]);
    if (rel.includes('[') || rel.includes(']')) continue;
    const abs = resolve(dir, rel);
    if (/\.xml$/i.test(rel)) {
      await expandXml(abs, seen, out, missing, `${label} -> ${rel}`);
    } else if (/\.lua$/i.test(rel)) {
      try {
        const s = await stat(abs);
        if (!s.isFile()) throw new Error('not a file');
        out.push(abs);
      } catch {
        missing.push(`${label} -> ${rel}`);
      }
    }
  }
}

/**
 * Resolve a .toc's file list against the filesystem, following .xml script includes.
 * @returns {{ resolved: {relative, absolute}[], missing: string[] }}
 */
export async function resolveTocFiles(toc) {
  const root = dirname(toc.path);
  const resolved = [];
  const missing = [];
  const seenXml = new Set();
  const seenLua = new Set();

  const push = (rel, abs) => {
    if (seenLua.has(abs)) return;
    seenLua.add(abs);
    resolved.push({ relative: rel, absolute: abs });
  };

  for (const rel of toc.files) {
    const abs = resolve(root, rel);
    try {
      const s = await stat(abs);
      if (!s.isFile()) throw new Error('not a file');
      push(rel, abs);
    } catch {
      missing.push(rel);
    }
  }

  for (const rel of toc.other) {
    if (!/\.xml$/i.test(rel)) continue;
    const fromXml = [];
    await expandXml(resolve(root, rel), seenXml, fromXml, missing, rel);
    for (const abs of fromXml) push(relative(root, abs).split('\\').join('/'), abs);
  }

  return { resolved, missing };
}

/** Recursively collect .lua files under a directory (fallback when there is no .toc). */
export async function collectLuaFiles(dir) {
  const out = [];
  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name === '.git' || e.name === 'node_modules' || e.name === 'Libs' || e.name === '.github') continue;
      const p = join(current, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.lua')) out.push(p);
    }
  }
  await walk(dir);
  return out;
}

export function toPosix(p) {
  return p.split(sep).join(posix.sep);
}
