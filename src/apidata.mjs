// Builds and loads the vendored snapshot of Blizzard's generated API documentation.
//
// The documentation is Lua source. Every file declares one or more `System` tables carrying
// `Functions` and `Tables` arrays. Blizzard annotates secrecy at four levels, all of which
// this module preserves:
//
//   SecretReturns = true            function always returns a secret value
//   SecretValue = true              a single return entry is always secret
//   SecretWhen*/SecretIn*/          function returns a secret only while that restriction is
//     SecretReturnsForAspect        active (cooldowns hidden, chat lockdown, arena, ...)
//   NeverSecret / ConditionalSecret per-field markers on returned structures
//
// We parse the Lua rather than regexing it so nested tables and multi-line entries
// cannot skew the result.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import luaparse from './luaparse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SNAPSHOT_PATH = join(HERE, '..', 'data', 'api-snapshot.json');

const CONTENTS_URL =
  'https://api.github.com/repos/Gethe/wow-ui-source/contents/Interface/AddOns/Blizzard_APIDocumentationGenerated?ref=live';
const RAW_BASE =
  'https://raw.githubusercontent.com/Gethe/wow-ui-source/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/';

/** A function-level key that makes the return value secret under some runtime condition. */
export function isConditionalKey(key) {
  return /^Secret(When|In)[A-Z]/.test(key) || key === 'SecretReturnsForAspect';
}

/** Turn a luaparse literal/table node into a plain JS value. */
function toValue(node) {
  if (!node) return null;
  switch (node.type) {
    case 'StringLiteral':
      return node.value !== null && node.value !== undefined
        ? node.value
        : node.raw.replace(/^\[=*\[([\s\S]*)\]=*\]$/, '$1').replace(/^["']|["']$/g, '');
    case 'NumericLiteral':
    case 'BooleanLiteral':
      return node.value;
    case 'NilLiteral':
      return null;
    case 'UnaryExpression': {
      const inner = toValue(node.argument);
      return node.operator === '-' && typeof inner === 'number' ? -inner : inner;
    }
    case 'Identifier':
      return { __ref: node.name };
    case 'MemberExpression':
      return { __ref: flattenMember(node) };
    case 'TableConstructorExpression': {
      const arr = [];
      const obj = {};
      let hasKeys = false;
      for (const f of node.fields) {
        if (f.type === 'TableValue') {
          arr.push(toValue(f.value));
        } else if (f.type === 'TableKeyString') {
          hasKeys = true;
          obj[f.key.name] = toValue(f.value);
        } else if (f.type === 'TableKey') {
          hasKeys = true;
          const k = toValue(f.key);
          obj[String(k && k.__ref ? k.__ref : k)] = toValue(f.value);
        }
      }
      if (hasKeys && arr.length) return { ...obj, __array: arr };
      return hasKeys ? obj : arr;
    }
    default:
      return null;
  }
}

function flattenMember(node) {
  const parts = [];
  let cur = node;
  while (cur && cur.type === 'MemberExpression') {
    parts.unshift(cur.identifier.name);
    cur = cur.base;
  }
  if (cur && cur.type === 'Identifier') parts.unshift(cur.name);
  return parts.join('.');
}

function collectSystems(value, out, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const v of value) collectSystems(v, out, seen);
    return;
  }
  // Most files declare `Type = "System"`, but shared-structure files (e.g. SpellShared)
  // declare a bare table holding only `Tables`.
  if (value.Type === 'System' || Array.isArray(value.Functions) || Array.isArray(value.Tables)) {
    out.push(value);
    return;
  }
  for (const v of Object.values(value)) collectSystems(v, out, seen);
}

function conditionsOf(entry) {
  const out = [];
  for (const [k, v] of Object.entries(entry)) {
    if (!isConditionalKey(k)) continue;
    if (v === true) out.push(k);
    else if (Array.isArray(v)) {
      const aspects = v.map((a) => (a && a.__ref ? a.__ref.split('.').pop() : String(a))).join('/');
      out.push(aspects ? `${k}(${aspects})` : k);
    }
  }
  return out;
}

function mapReturns(list) {
  return (Array.isArray(list) ? list : [])
    .filter((r) => r && typeof r === 'object')
    .map((r) => {
      const out = { name: r.Name ?? null, type: r.Type ?? null, nilable: r.Nilable === true };
      if (r.SecretValue === true) out.secretValue = true;
      if (r.ConditionalSecret === true) out.conditionalSecret = true;
      if (r.NeverSecret === true) out.neverSecret = true;
      return out;
    });
}

/**
 * Extract every documented function and structure from one documentation file's Lua source.
 */
export function extractFile(luaSource, fileLabel = '<memory>') {
  let ast;
  try {
    ast = luaparse.parse(luaSource, { locations: false, luaVersion: '5.1', comments: false });
  } catch (err) {
    throw new Error(`could not parse ${fileLabel}: ${err.message}`);
  }

  const roots = [];
  for (const stmt of ast.body) {
    if (stmt.type === 'LocalStatement' || stmt.type === 'AssignmentStatement') {
      for (const init of stmt.init || []) {
        if (init.type === 'TableConstructorExpression') roots.push(toValue(init));
      }
    }
  }

  const systems = [];
  for (const r of roots) collectSystems(r, systems);

  const functions = [];
  const structures = [];

  for (const sys of systems) {
    const namespace = typeof sys.Namespace === 'string' ? sys.Namespace : null;
    const system = typeof sys.Name === 'string' ? sys.Name : null;

    for (const f of Array.isArray(sys.Functions) ? sys.Functions : []) {
      if (!f || typeof f !== 'object' || typeof f.Name !== 'string') continue;
      if (f.Type && f.Type !== 'Function') continue;
      const returns = mapReturns(f.Returns);
      const conditional = conditionsOf(f);
      for (const r of returns) if (r.conditionalSecret && !conditional.length) conditional.push('ConditionalSecret');
      functions.push({
        name: f.Name,
        namespace,
        system,
        secretReturns: f.SecretReturns === true || returns.some((r) => r.secretValue),
        conditional: conditional.length ? conditional : null,
        secretArguments: typeof f.SecretArguments === 'string' ? f.SecretArguments : null,
        args: (Array.isArray(f.Arguments) ? f.Arguments : [])
          .filter((a) => a && typeof a === 'object')
          .map((a) => ({ name: a.Name ?? null, type: a.Type ?? null, nilable: a.Nilable === true })),
        returns,
      });
    }

    for (const t of Array.isArray(sys.Tables) ? sys.Tables : []) {
      if (!t || typeof t !== 'object' || typeof t.Name !== 'string') continue;
      if (t.Type !== 'Structure') continue;
      const fields = {};
      let annotated = false;
      for (const fl of Array.isArray(t.Fields) ? t.Fields : []) {
        if (!fl || typeof fl !== 'object' || typeof fl.Name !== 'string') continue;
        const rec = { type: fl.Type ?? null };
        if (fl.NeverSecret === true) {
          rec.neverSecret = true;
          annotated = true;
        }
        if (fl.ConditionalSecret === true) {
          rec.conditionalSecret = true;
          annotated = true;
        }
        if (fl.SecretValue === true) {
          rec.secretValue = true;
          annotated = true;
        }
        fields[fl.Name] = rec;
      }
      structures.push({ name: t.Name, annotated, fields });
    }
  }

  return { functions, structures };
}

/** Shape the per-file records into the on-disk snapshot. */
export function buildIndex(files, meta = {}) {
  const functions = {};
  const structures = {};
  let secretReturnCount = 0;
  let conditionalCount = 0;

  for (const { structures: structs } of files) {
    for (const s of structs) {
      if (!structures[s.name] || (s.annotated && !structures[s.name].annotated)) {
        structures[s.name] = { annotated: s.annotated, fields: s.fields };
      }
    }
  }

  const put = (key, entry, preferSecret) => {
    const prev = functions[key];
    if (!prev || (preferSecret && !prev.secretReturns)) functions[key] = entry;
  };

  for (const { functions: fns } of files) {
    for (const fn of fns) {
      const entry = {
        secretReturns: fn.secretReturns,
        conditional: fn.conditional,
        secretArguments: fn.secretArguments,
        system: fn.system,
        namespace: fn.namespace,
        args: fn.args,
        returns: fn.returns,
      };
      if (fn.secretReturns) secretReturnCount += 1;
      else if (fn.conditional) conditionalCount += 1;
      const qualified = fn.namespace ? `${fn.namespace}.${fn.name}` : fn.name;
      put(qualified, entry, fn.secretReturns);
      // Namespaced functions usually also exist as a global alias in retail. Register the
      // bare name too, but never let it clobber a distinct non-namespaced global.
      if (fn.namespace) put(fn.name, { ...entry, viaNamespace: fn.namespace }, fn.secretReturns);
    }
  }

  // Sort so a rebuild produces a byte-comparable diff against the vendored copy.
  const sorted = (obj) =>
    Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));

  return {
    source: 'Gethe/wow-ui-source@live Interface/AddOns/Blizzard_APIDocumentationGenerated',
    generated: meta.generated ?? null,
    files: meta.files ?? null,
    functionCount: Object.keys(functions).length,
    structureCount: Object.keys(structures).length,
    secretReturnCount,
    conditionalCount,
    functions: sorted(functions),
    structures: sorted(structures),
  };
}

async function getJson(url) {
  const res = await fetch(url, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'wow-secret-lint' },
  });
  if (res.status === 403 || res.status === 429) {
    throw new Error(
      `GitHub rate-limited the contents API (HTTP ${res.status}). Wait for the limit to reset or set GITHUB_TOKEN, then retry --refresh.`
    );
  }
  if (!res.ok) throw new Error(`GitHub contents API returned HTTP ${res.status} for ${url}`);
  return res.json();
}

/**
 * Rebuild the snapshot from the live mirror. Only `--refresh` reaches the network.
 * `onProgress` is called with ({ done, total, file }) so a long fetch narrates itself.
 */
export async function refreshSnapshot({ onProgress, concurrency = 8, fetchImpl = fetch } = {}) {
  const listing = await getJson(CONTENTS_URL);
  if (!Array.isArray(listing)) throw new Error('GitHub contents API did not return a file listing');
  const names = listing
    .filter((f) => f.type === 'file' && f.name.endsWith('.lua'))
    .map((f) => f.name)
    .sort();
  if (!names.length) throw new Error('no .lua documentation files found in the mirror');

  const parsed = new Array(names.length);
  const failures = [];
  let done = 0;
  let cursor = 0;

  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= names.length) return;
      const name = names[i];
      try {
        const res = await fetchImpl(RAW_BASE + name, { headers: { 'user-agent': 'wow-secret-lint' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        parsed[i] = extractFile(await res.text(), name);
      } catch (err) {
        failures.push({ file: name, error: err.message });
      }
      done += 1;
      if (onProgress) onProgress({ done, total: names.length, file: name });
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, names.length) }, worker));

  if (failures.length > names.length / 10) {
    throw new Error(
      `${failures.length}/${names.length} documentation files failed to download or parse; refusing to write a partial snapshot`
    );
  }

  // Workers finish out of order; index in listing order so the snapshot is reproducible.
  const index = buildIndex(parsed.filter(Boolean), {
    generated: new Date().toISOString(),
    files: names.length,
  });
  index.failures = failures;
  return index;
}

export async function writeSnapshot(index, path = SNAPSHOT_PATH) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(index) + '\n', 'utf8');
  return path;
}

let cached = null;

/** Load the vendored snapshot. Never touches the network. */
export async function loadSnapshot(path = SNAPSHOT_PATH) {
  if (cached && cached.path === path) return cached.index;
  if (!existsSync(path)) {
    throw new Error(
      `API snapshot missing at ${path}. Run "wow-secret-lint --refresh" to rebuild it (needs network access).`
    );
  }
  let index;
  try {
    index = JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    throw new Error(`API snapshot at ${path} is not readable JSON: ${err.message}`);
  }
  if (!index || typeof index.functions !== 'object' || index.functions === null) {
    throw new Error(`API snapshot at ${path} has no "functions" table; rebuild it with --refresh`);
  }
  index.structures ??= {};
  cached = { path, index };
  return index;
}
