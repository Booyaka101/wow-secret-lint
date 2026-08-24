// Public API and the lint driver that ties .toc discovery, analysis and reporting together.

import { readFile, stat } from 'node:fs/promises';
import { relative, resolve, dirname } from 'node:path';
import { analyzeSource } from './analyze.mjs';
import { loadSnapshot } from './apidata.mjs';
import { findTocFilesDeep, parseToc, resolveTocFiles, collectLuaFiles, isRetailToc, toPosix } from './toc.mjs';

export { RULES, RULE_IDS } from './rules.mjs';
export { analyzeSource } from './analyze.mjs';
export { loadSnapshot, refreshSnapshot, writeSnapshot, extractFile, buildIndex, SNAPSHOT_PATH } from './apidata.mjs';
export { format, formatStylish, formatJson, formatGithub, FORMATS } from './report.mjs';
export { parseToc, findTocFiles, findTocFilesDeep, isRetailToc } from './toc.mjs';

export const VERSION = '1.2.0';

/**
 * Lint an addon directory or a single .lua/.toc file.
 *
 * @param {string} target       path to an addon folder, a .toc, or a .lua file
 * @param {object} options
 * @param {'retail'|'classic'} options.game
 * @param {'warn'|'error'|'off'} options.conditional  how to treat conditionally secret APIs
 * @param {string[]} options.disable  rule ids to silence
 * @param {string[]} options.secretGuards  extra is-secret wrapper names, e.g. IsSecret
 * @param {string[]} options.accessGuards  extra can-access wrapper names
 * @param {boolean} options.strict  raise SecretReturns findings from warning to error
 * @param {string} options.snapshotPath
 * @param {string} options.cwd  paths in the report are made relative to this
 */
export async function lint(target, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const game = options.game ?? 'retail';
  const result = {
    version: VERSION,
    target,
    game,
    filesScanned: 0,
    findings: [],
    parseErrors: [],
    warningsBeforeLint: [],
    snapshot: { source: null, generated: null, functionCount: 0, secretReturnCount: 0, conditionalCount: 0 },
  };

  if (game === 'classic') {
    result.warningsBeforeLint.push('classic has no secret values; nothing to check');
    return result;
  }

  const api = await loadSnapshot(options.snapshotPath);
  result.snapshot = {
    source: api.source,
    generated: api.generated,
    functionCount: api.functionCount,
    secretReturnCount: api.secretReturnCount,
    conditionalCount: api.conditionalCount ?? 0,
  };

  const abs = resolve(cwd, target);
  let info;
  try {
    info = await stat(abs);
  } catch {
    throw new Error(`no such file or directory: ${target}`);
  }

  /** @type {{relative: string, absolute: string}[]} */
  let files = [];

  if (info.isFile() && abs.toLowerCase().endsWith('.toc')) {
    files = await filesFromToc(abs, result, cwd);
  } else if (info.isFile()) {
    if (!abs.toLowerCase().endsWith('.lua')) {
      throw new Error(`not a Lua or .toc file: ${target}`);
    }
    files = [{ relative: toPosix(relative(cwd, abs)) || abs, absolute: abs }];
  } else {
    const label = toPosix(relative(cwd, abs)) || abs;
    const allTocs = await findTocFilesDeep(abs);
    const parsed = [];
    for (const path of allTocs) {
      try {
        parsed.push(await parseToc(path));
      } catch (err) {
        result.warningsBeforeLint.push(err.message);
      }
    }
    const retail = parsed.filter(isRetailToc);

    if (retail.length) {
      const seen = new Set();
      for (const toc of retail) {
        for (const f of await filesFromToc(toc.path, result, cwd)) {
          if (seen.has(f.absolute)) continue;
          seen.add(f.absolute);
          files.push(f);
        }
      }
    } else if (parsed.length) {
      // Every .toc targets a Classic flavour, which has no secret values. Walking the Lua
      // anyway would report findings against code that never runs on retail.
      result.warningsBeforeLint.push(
        `${label}: found ${parsed.length} .toc file(s), none targeting retail; nothing to check`
      );
    } else {
      const found = await collectLuaFiles(abs);
      if (found.length) {
        result.warningsBeforeLint.push(
          `${label}: no .toc found, scanning every .lua instead; flavour cannot be determined`
        );
      } else {
        result.warningsBeforeLint.push(`no .toc and no .lua files found under ${label}`);
      }
      files = found.map((p) => ({ relative: toPosix(relative(cwd, p)) || p, absolute: p }));
    }
  }

  const analyzeOptions = {
    conditional: options.conditional ?? 'off',
    disable: new Set(options.disable ?? []),
    secretGuards: new Set(options.secretGuards ?? []),
    accessGuards: new Set(options.accessGuards ?? []),
    strict: options.strict === true,
  };

  for (const file of files) {
    let source;
    try {
      source = await readFile(file.absolute, 'utf8');
    } catch (err) {
      result.warningsBeforeLint.push(`skipped ${file.relative}: ${err.code === 'ENOENT' ? 'file disappeared' : err.message}`);
      continue;
    }
    result.filesScanned += 1;
    const { findings, parseError } = analyzeSource(source.replace(/^﻿/, ''), file.relative, api, analyzeOptions);
    if (parseError) result.parseErrors.push(parseError);
    result.findings.push(...findings);
  }

  result.findings.sort(byLocation);
  return result;
}

/** Order findings the way both reporters and both entrypoints present them. */
export function byLocation(a, b) {
  return (
    a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column || a.ruleId.localeCompare(b.ruleId)
  );
}

/** Lint several targets and merge them into one result. Shared by the CLI and the Action. */
export async function lintPaths(paths, options = {}) {
  const merged = {
    version: VERSION,
    filesScanned: 0,
    findings: [],
    parseErrors: [],
    warningsBeforeLint: [],
    snapshot: {},
  };
  for (const target of paths) {
    const result = await lint(target, options);
    merged.snapshot = result.snapshot;
    merged.filesScanned += result.filesScanned;
    merged.findings.push(...result.findings);
    merged.parseErrors.push(...result.parseErrors);
    merged.warningsBeforeLint.push(...result.warningsBeforeLint);
  }
  merged.findings.sort(byLocation);
  return merged;
}

async function filesFromToc(tocPath, result, cwd) {
  const toc = await parseToc(tocPath);
  const { resolved, missing } = await resolveTocFiles(toc);
  const tocLabel = toPosix(relative(cwd, tocPath)) || tocPath;
  for (const m of missing) {
    result.warningsBeforeLint.push(`${tocLabel}: listed file not found on disk: ${m}`);
  }
  if (!resolved.length && !missing.length) {
    result.warningsBeforeLint.push(`${tocLabel}: lists no .lua files`);
  }
  return resolved.map((f) => ({
    relative: toPosix(relative(cwd, f.absolute)) || f.absolute,
    absolute: f.absolute,
  }));
}
