// Scope chains and taint propagation for one Lua file.
//
// A value is TAINTED-SECRET when it comes from an API that Blizzard documents as
// SecretReturns = true (or whose return entry carries SecretValue = true). It is
// TAINTED-CONDITIONAL when the API is only secret while a restriction is active
// (SecretWhen*/SecretIn*/SecretReturnsForAspect) or when it is an unannotated field of a
// structure that Blizzard marks up with NeverSecret.
//
// Taint flows through plain assignment, table field stores, the return value of a
// file-local function, and one level of intra-file call-argument passing. It is cleared
// inside guarded branches and at any scrubsecretvalues/secretwrap boundary.

import luaparse from './luaparse.mjs';
import {
  RULES,
  guardByName,
  SCRUBBERS,
  ALLOWED_SINKS,
  COMBAT_LOG_EVENTS,
  COMBAT_LOG_REPLACEMENT,
  booleanTestSeverity,
  DEFAULT_PATCH,
  AURA_SECRET_APIS,
  AURA_ERRORING_CALLS,
  IDENTITY_SECRET_APIS,
  SELF_EXEMPT_TOKENS,
  AURA_STATE_IDENTITY_APIS,
  CATEGORY_RULES,
  ITERATORS,
  AURA_SUGGESTION,
  REMOVED_CALLS,
  REMOVED_TEMPLATE,
  REMOVED_TEMPLATE_MESSAGE,
  RENAMED_STRUCT_FIELDS,
  ASPECT_FRAME_TYPES,
  AURA_GROUP_METHODS,
  FORBIDDEN_ASPECT_METHODS,
  patchAtLeast,
  NEW_ASPECT_RULES,
  ANIMATION_SYSTEMS,
  PANDEMIC_KINDS,
  PANDEMIC_ANIMATION_METHODS,
  ANIMATION_FACTORIES,
  COOLDOWN_SYSTEM,
  COOLDOWN_FIELDS,
  COOLDOWN_SUGGESTION,
  HOOK_SUGGESTION,
  PROTECTED_COOLDOWN_GLOBAL,
  PROTECTED_BUTTON_GLOBAL,
  isProtectedTemplate,
} from './rules.mjs';

const ARITHMETIC = new Set(['+', '-', '*', '/', '%', '^']);

/** Stands in for whatever name each file gives the addon's private table. */
const NS_ROOT = '<ns>';
const RELATIONAL = new Set(['<', '<=', '>', '>=', '==', '~=']);

/** Depth-first walk of an AST subtree. Return false from `visit` to prune that branch. */
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (node.type && visit(node) === false) return;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'range') continue;
    if (value && typeof value === 'object') walk(value, visit);
  }
}

class Scope {
  constructor(parent = null) {
    this.parent = parent;
    this.vars = new Map();
  }
  declare(name, taint) {
    this.vars.set(name, taint ?? null);
  }
  lookupScope(name) {
    for (let s = this; s; s = s.parent) if (s.vars.has(name)) return s;
    return null;
  }
  get(name) {
    const s = this.lookupScope(name);
    return s ? s.vars.get(name) : undefined;
  }
  set(name, taint) {
    const s = this.lookupScope(name);
    (s ?? this).vars.set(name, taint ?? null);
  }
}

function stringValue(node) {
  if (!node || node.type !== 'StringLiteral') return null;
  if (node.value !== null && node.value !== undefined) return node.value;
  return node.raw.replace(/^\[=*\[([\s\S]*)\]=*\]$/, '$1').replace(/^["']|["']$/g, '');
}

function pos(node) {
  const loc = node && node.loc ? node.loc.start : null;
  return { line: loc ? loc.line : 0, column: loc ? loc.column + 1 : 0 };
}

class Analyzer {
  constructor({ api, filePath, options }) {
    this.api = api;
    this.filePath = filePath;
    this.options = options;
    this.findings = [];
    this.seen = new Set();
    this.cleared = new Set(); // guarded paths, prefix-matched
    this.fieldTaint = new Map(); // dotted path -> taint
    this.localFns = new Map(); // name -> { node, analysed, secretReturns }
    this.reportedOrigins = new Set(); // binding ids that already produced a finding
    this.bindings = new Map(); // binding id -> { taint, uses, guarded, node }
    this.bindingSeq = 0;
    this.callDepth = 0;
    this.analysedWithTaint = new Set();
    this.patch121 = patchAtLeast(options.patch, '12.1');
    this.patch1215 = patchAtLeast(options.patch, '12.1.5');
    this.widgetOf = new Map(); // dotted path -> widget kind, e.g. 'AuraButton', 'ProtectedCooldown'
    this.tableFields = new Map(); // dotted path -> Map(fieldName -> key node)
    this.animationOwner = new Map(); // animation path -> the group path it was created on
    this.loopCounters = new Set(); // numeric for-loop variables in scope, e.g. the i of "ActionButton"..i
    this.unprotected = new Set(); // paths inside a branch that tested frame:IsProtected() false
    this.hookedHandlers = new Set(); // function nodes hooksecurefunc installs on the Cooldown widget type
    this.hookedHandlerNames = new Set(); // the same, by dotted name, for handlers defined out of line
    this.stringConst = new Map(); // dotted path -> its string value, for `local PLAYER = "player"`
    this.guardArgDepth = 0; // > 0 while evaluating the arguments of a guard or scrubber call
    this.fileLocals = new Set(); // every name declared local anywhere in this file
    this.nsLocal = null; // the local holding the addon's private table: `local _, ns = ...`
  }

  // ---------------------------------------------------------------- findings

  report(ruleId, node, message, { severity, taint } = {}) {
    const rule = RULES[ruleId];
    let sev = severity ?? rule.severity;
    if (taint && taint.kind === 'conditional') {
      if (this.options.conditional === 'off') return;
      if (this.options.conditional === 'warn' && sev === 'error') sev = 'warning';
    }
    // Findings that rest on SecretReturns report as warnings unless --strict. Whether those
    // APIs really hand a secret to tainted code on every call is unconfirmed in game, so the
    // default is an inventory of exposure, not a verdict. Rules with no taint behind them
    // (WSL008, WSL014-017) are deterministic and keep their severity, as do the 12.1 aura
    // and identity rules: the patch notes state the secrecy outright and every player enters
    // the states that activate it.
    const patchBreaking = ruleId === 'WSL012' || ruleId === 'WSL013';
    if (taint && taint.kind === 'secret' && sev === 'error' && !this.options.strict && !patchBreaking) {
      sev = 'warning';
    }
    if (this.options.disable.has(ruleId)) return;
    const p = pos(node);
    const key = `${ruleId}:${p.line}:${p.column}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    if (taint && taint.bindingId != null) this.reportedOrigins.add(taint.bindingId);
    this.findings.push({
      file: this.filePath,
      line: p.line,
      column: p.column,
      severity: sev,
      ruleId,
      message,
      api: taint ? taint.origin : null,
      conditions: taint && taint.conditions ? taint.conditions : null,
    });
  }

  describe(taint) {
    if (!taint) return 'a secret value';
    const name = taint.label ? `'${taint.label}' ` : '';
    if (taint.category === 'aura') {
      return `${name}derives from ${taint.origin}(), secret in 12.1 while auras are secret (combat, encounters, M+, PvP); ${AURA_SUGGESTION}`;
    }
    if (taint.category === 'identity') {
      return `${name}derives from ${taint.origin}(), whose returns are secret in 12.1 while the unit's identity is secret`;
    }
    if (taint.kind === 'conditional') {
      const why = taint.conditions && taint.conditions.length ? taint.conditions.join(', ') : 'a runtime restriction';
      return `${name}derives from ${taint.origin}() (conditionally secret: ${why})`;
    }
    return `${name}derives from ${taint.origin}() (SecretReturns=true)`;
  }

  // ------------------------------------------------------------------ paths

  pathOf(node) {
    if (!node) return null;
    if (node.type === 'Identifier') return node.name;
    if (node.type === 'MemberExpression') {
      const base = this.pathOf(node.base);
      return base ? `${base}.${node.identifier.name}` : null;
    }
    if (node.type === 'IndexExpression') {
      const base = this.pathOf(node.base);
      const key = stringValue(node.index);
      return base && key !== null ? `${base}.${key}` : null;
    }
    return null;
  }

  isCleared(path) {
    if (!path) return false;
    if (this.cleared.has(path)) return true;
    for (const p of this.cleared) if (path.startsWith(p + '.')) return true;
    return false;
  }

  // ------------------------------------------------------------------ taint

  makeTaint({ kind, origin, type, conditions, structure, label, bindingId, container, category }) {
    return {
      kind,
      origin,
      type: type ?? null,
      conditions: conditions ?? null,
      structure: structure ?? null,
      // A documented structure is not itself a secret; its unmarked fields are.
      container: container === true,
      // 'aura' or 'identity' reroutes operator findings to WSL012/WSL013.
      category: category ?? null,
      label: label ?? null,
      bindingId: bindingId ?? null,
    };
  }

  /** Operator findings on a categorised taint report as the 12.1 rule for that category. */
  ruleFor(defaultId, taint) {
    return taint && taint.category ? CATEGORY_RULES[taint.category] : defaultId;
  }

  /** Resolve the callee of a CallExpression to a documented API name, or null. */
  calleeName(node) {
    const base = node.base;
    if (!base) return null;
    if (base.type === 'Identifier') return { name: base.name, method: false };
    if (base.type === 'MemberExpression') {
      if (base.indexer === ':') return { name: base.identifier.name, method: true };
      const path = this.pathOf(base);
      return path ? { name: path, method: false } : { name: base.identifier.name, method: false };
    }
    return null;
  }

  apiEntry(name) {
    if (!name) return null;
    return Object.prototype.hasOwnProperty.call(this.api.functions, name) ? this.api.functions[name] : null;
  }

  /** Taint carried by return position `index` (0-based) of a documented API call. */
  returnTaint(name, entry, index, node) {
    const ret = entry.returns && entry.returns[index] ? entry.returns[index] : null;
    // Aura secrecy is behavioural, so the generated docs carry no marker for it and the
    // 12.1 lists seed it here, ahead of the snapshot's own annotations. All return
    // positions are secret, and no structure is recorded because the value is a full
    // secret: reading a field of it is itself the violation.
    if (this.patch121) {
      if (AURA_SECRET_APIS.has(name)) {
        return this.makeTaint({ kind: 'secret', origin: name, type: ret ? ret.type : null, category: 'aura' });
      }
      if (IDENTITY_SECRET_APIS.has(name) && !this.selfExempt(name, node)) {
        return this.makeTaint({ kind: 'secret', origin: name, type: ret ? ret.type : null, category: 'identity' });
      }
    }
    if (ret && ret.neverSecret) return null;
    const type = ret ? ret.type : null;
    const structure = type && this.api.structures[type] ? type : null;

    const explicit = entry.returns && entry.returns.some((r) => r.secretValue);
    if (entry.secretReturns && (!explicit || (ret && ret.secretValue))) {
      if (structure) return this.makeTaint({ kind: 'secret', origin: name, type, structure, container: true });
      return this.makeTaint({ kind: 'secret', origin: name, type });
    }
    if (entry.conditional) {
      if (structure) {
        return this.makeTaint({
          kind: 'conditional',
          origin: name,
          type,
          structure,
          conditions: entry.conditional,
          container: true,
        });
      }
      return this.makeTaint({ kind: 'conditional', origin: name, type, conditions: entry.conditional });
    }
    if (ret && ret.conditionalSecret) {
      return this.makeTaint({
        kind: 'conditional',
        origin: name,
        type,
        conditions: ['ConditionalSecret'],
      });
    }
    return null;
  }

  /**
   * Taint of an expression. Reading an expression may itself produce findings, so callers
   * that only want the taint (e.g. assignment right-hand sides) pass through `evaluate`.
   */
  taintOf(node, scope) {
    if (!node) return null;
    switch (node.type) {
      case 'Identifier': {
        if (this.isCleared(node.name)) return null;
        const t = scope.get(node.name) ?? this.fieldTaint.get(node.name) ?? null;
        return t ? { ...t, label: node.name } : null;
      }
      case 'MemberExpression':
      case 'IndexExpression': {
        const path = this.pathOf(node);
        if (path && this.isCleared(path)) return null;
        if (path && this.fieldTaint.has(path)) {
          const t = this.fieldTaint.get(path);
          return t ? { ...t, label: path } : null;
        }
        const baseTaint = this.taintOf(node.base, scope);
        if (!baseTaint) return null;
        const field =
          node.type === 'MemberExpression' ? node.identifier.name : stringValue(node.index);
        if (baseTaint.structure && field) {
          const struct = this.api.structures[baseTaint.structure];
          const meta = struct && struct.fields ? struct.fields[field] : null;
          if (meta && meta.neverSecret) return null;
          if (!meta) return null; // unknown field on a documented structure: stay quiet
          const inner = meta.type && this.api.structures[meta.type] ? meta.type : null;
          return this.makeTaint({
            kind: meta.secretValue ? 'secret' : baseTaint.kind,
            origin: baseTaint.origin,
            type: meta.type,
            structure: inner,
            conditions: baseTaint.conditions,
            label: path,
            bindingId: baseTaint.bindingId,
          });
        }
        if (baseTaint.container) return null;
        return { ...baseTaint, label: path ?? baseTaint.label };
      }
      case 'CallExpression':
      case 'StringCallExpression':
      case 'TableCallExpression': {
        const callee = this.calleeName(node);
        if (!callee) return null;
        if (SCRUBBERS.has(callee.name) || ALLOWED_SINKS.has(callee.name)) return null;
        if (!callee.method) {
          const entry = this.apiEntry(callee.name);
          if (entry) return this.returnTaint(callee.name, entry, 0, node);
          const local = this.localFns.get(callee.name);
          if (local && local.secretReturns) return { ...local.secretReturns, label: null };
        }
        return null;
      }
      case 'BinaryExpression':
        if (node.operator === '..') {
          return this.taintOf(node.left, scope) ?? this.taintOf(node.right, scope);
        }
        return null;
      case 'LogicalExpression':
        return this.taintOf(node.left, scope) ?? this.taintOf(node.right, scope);
      default:
        return null;
    }
  }

  // ----------------------------------------------------------------- guards

  /** Resolve a callee to a guard shape, honouring user-supplied wrapper names. */
  guardShape(callee) {
    if (!callee) return null;
    const bare = callee.name.includes('.') ? callee.name.slice(callee.name.lastIndexOf('.') + 1) : callee.name;
    if (this.options.secretGuards.has(bare)) return { safeWhen: false, prefix: false };
    if (this.options.accessGuards.has(bare)) return { safeWhen: true, prefix: false };
    return guardByName(callee.name);
  }

  /** Extract guard information from a condition expression. */
  guardsOf(node, scope) {
    const empty = { whenTrue: [], whenFalse: [] };
    if (!node) return empty;
    if (node.type === 'UnaryExpression' && node.operator === 'not') {
      const inner = this.guardsOf(node.argument, scope);
      return { whenTrue: inner.whenFalse, whenFalse: inner.whenTrue };
    }
    if (node.type === 'LogicalExpression') {
      const l = this.guardsOf(node.left, scope);
      const r = this.guardsOf(node.right, scope);
      if (node.operator === 'and') return { whenTrue: [...l.whenTrue, ...r.whenTrue], whenFalse: [] };
      return { whenTrue: [], whenFalse: [...l.whenFalse, ...r.whenFalse] };
    }
    if (node.type === 'BinaryExpression' && (node.operator === '==' || node.operator === '~=')) {
      // `issecretvalue(x) == false` and friends.
      const inner = this.guardsOf(node.left, scope);
      const rhs = node.right;
      const isFalse = rhs && (rhs.type === 'BooleanLiteral' ? rhs.value === false : rhs.type === 'NilLiteral');
      const flip = (node.operator === '==') === isFalse ? false : true;
      return flip ? inner : { whenTrue: inner.whenFalse, whenFalse: inner.whenTrue };
    }
    if (node.type === 'CallExpression') {
      const callee = this.calleeName(node);
      if (!callee) return empty;
      // `if frame:IsProtected() then return end` is the check WSL021 asks for; it clears the
      // frame for protected-method calls only, not for taint.
      if (callee.method && callee.name === 'IsProtected') {
        const recv = node.base && node.base.base ? this.pathOf(node.base.base) : null;
        return recv ? { whenTrue: [], whenFalse: [{ path: recv, prefix: false, set: 'unprotected' }] } : empty;
      }
      const g = this.guardShape(callee);
      if (!g) return empty;
      // `obj:HasSecretValues()` guards the receiver; `issecretvalue(x)` guards its arguments.
      const paths = node.arguments.map((a) => this.pathOf(a)).filter(Boolean);
      if (!paths.length && callee.method) {
        const recv = node.base && node.base.base ? this.pathOf(node.base.base) : null;
        if (recv) paths.push(recv);
      }
      if (!paths.length) return empty;
      // An aura is secret or readable as a unit, so a guard naming one field of a
      // category-tainted value (issecretvalue(aura.name)) vouches for the whole value.
      for (const p of [...paths]) {
        const root = p.split('.')[0];
        if (root === p) continue;
        const t = scope.get(root);
        if (t && t.category) paths.push(root);
      }
      const marks = paths.map((p) => ({ path: p, prefix: g.prefix }));
      return g.safeWhen ? { whenTrue: marks, whenFalse: [] } : { whenTrue: [], whenFalse: marks };
    }
    return empty;
  }

  applyGuards(marks) {
    const added = [];
    for (const m of marks) {
      const set = m.set === 'unprotected' ? this.unprotected : this.cleared;
      if (!set.has(m.path)) {
        set.add(m.path);
        added.push({ set, path: m.path });
      }
    }
    return added;
  }

  releaseGuards(added) {
    for (const { set, path } of added) set.delete(path);
  }

  /**
   * True when this file guards `path` anywhere at all, or guards any field of it.
   * WSL010 is a "nobody here is thinking about secrets" nudge, so one guard mentioning the
   * value anywhere is enough to silence it.
   */
  guardsSomewhere(path) {
    if (this.everGuarded.has(path)) return true;
    for (const p of this.everGuarded) {
      if (path.startsWith(p + '.') || p.startsWith(path + '.')) return true;
    }
    return false;
  }

  // -------------------------------------------------------------- traversal

  run(ast) {
    this.everGuarded = new Set();
    this.collectGuardedPaths(ast);
    this.collectFileLocals(ast);
    this.importWidgets(this.options.imports);
    const scope = new Scope(null);
    this.hoistLocalFunctions(ast.body, scope);
    if (this.patch1215) this.collectCooldownHooks(ast);
    this.block(ast.body, scope);
    this.reportUnguarded();
    this.findings.sort((a, b) => a.line - b.line || a.column - b.column || a.ruleId.localeCompare(b.ruleId));
    return this.findings;
  }

  /**
   * Pre-pass: every name this file declares local, and which of them is the addon's private
   * table (`local ADDON, ns = ...` or `local ns = select(2, ...)`). Widget typing crosses
   * files through globals and through that table, so both have to be told apart from
   * ordinary locals.
   */
  collectFileLocals(root) {
    const isVararg = (n) => n && n.type === 'VarargLiteral';
    const isSelect2 = (n) =>
      n &&
      n.type === 'CallExpression' &&
      n.base.type === 'Identifier' &&
      n.base.name === 'select' &&
      n.arguments.length === 2 &&
      n.arguments[0].type === 'NumericLiteral' &&
      n.arguments[0].value === 2 &&
      isVararg(n.arguments[1]);
    for (const stmt of root.body) {
      if (stmt.type !== 'LocalStatement') continue;
      stmt.variables.forEach((v, i) => {
        const init = stmt.init ? stmt.init[i] : null;
        if (v.type !== 'Identifier' || this.nsLocal) return;
        if ((i === 1 && isVararg(stmt.init[0])) || isSelect2(init)) this.nsLocal = v.name;
      });
    }
    walk(root, (n) => {
      if (n.type === 'LocalStatement') {
        for (const v of n.variables) if (v.type === 'Identifier') this.fileLocals.add(v.name);
      } else if (n.type === 'FunctionDeclaration') {
        if (n.isLocal && n.identifier && n.identifier.type === 'Identifier') this.fileLocals.add(n.identifier.name);
        for (const prm of n.parameters || []) if (prm.type === 'Identifier') this.fileLocals.add(prm.name);
      } else if (n.type === 'ForNumericStatement') {
        this.fileLocals.add(n.variable.name);
      } else if (n.type === 'ForGenericStatement') {
        for (const v of n.variables) this.fileLocals.add(v.name);
      }
    });
  }

  /**
   * Widget kinds earlier files in load order left behind, keyed by a path that is either a
   * global or `<ns>.field` for the addon's private table. A global this file redeclares as a
   * local keeps the local meaning.
   */
  importWidgets(imports) {
    for (const [path, kind] of imports ?? []) {
      const [root, ...rest] = path.split('.');
      if (root === NS_ROOT) {
        if (this.nsLocal) this.widgetOf.set([this.nsLocal, ...rest].join('.'), kind);
      } else if (!this.fileLocals.has(root)) {
        this.widgetOf.set(path, kind);
      }
    }
  }

  /** The widget kinds this file leaves for later files, in the same keyed form. */
  exportWidgets() {
    const out = [];
    for (const [path, kind] of this.widgetOf) {
      const [root, ...rest] = path.split('.');
      if (root === '_G' && rest.length) out.push([rest.join('.'), kind]);
      else if (this.nsLocal && root === this.nsLocal) out.push([[NS_ROOT, ...rest].join('.'), kind]);
      else if (!this.fileLocals.has(root)) out.push([path, kind]);
    }
    return out;
  }

  /** Pre-pass: every path that any guard in this file mentions. */
  collectGuardedPaths(root) {
    walk(root, (node) => {
      if (node.type !== 'CallExpression') return;
      for (const p of this.guardedPathsOf(node)) this.everGuarded.add(p);
    });
  }

  /** The paths a guard or scrubber call protects, or an empty array when it is neither. */
  guardedPathsOf(node) {
    const callee = this.calleeName(node);
    if (!callee) return [];
    if (!this.guardShape(callee) && !(!callee.method && SCRUBBERS.has(callee.name))) return [];
    const paths = node.arguments.map((a) => this.pathOf(a)).filter(Boolean);
    if (paths.length || !callee.method) return paths;
    const recv = node.base && node.base.base ? this.pathOf(node.base.base) : null;
    return recv ? [recv] : [];
  }

  hoistLocalFunctions(body, scope) {
    for (const stmt of body) {
      if (stmt.type === 'FunctionDeclaration' && stmt.identifier) {
        const name = this.pathOf(stmt.identifier);
        if (name) this.localFns.set(name, { node: stmt, secretReturns: null });
      } else if (stmt.type === 'LocalStatement') {
        stmt.variables.forEach((v, i) => {
          const init = stmt.init && stmt.init[i];
          if (init && init.type === 'FunctionDeclaration') {
            this.localFns.set(v.name, { node: init, secretReturns: null });
          }
        });
      }
    }
  }

  block(body, scope) {
    // An early exit guards the rest of its own block, not whatever comes after the block.
    const added = [];
    for (const stmt of body) {
      const trailing = this.statement(stmt, scope);
      if (trailing && trailing.length) added.push(...this.applyGuards(trailing));
    }
    this.releaseGuards(added);
  }

  /** Returns guard marks that apply to the rest of the enclosing block, if any. */
  statement(stmt, scope) {
    switch (stmt.type) {
      case 'LocalStatement':
        return this.assignment(stmt, scope, true);
      case 'AssignmentStatement':
        return this.assignment(stmt, scope, false);
      case 'CallStatement': {
        this.evaluate(stmt.expression, scope);
        const call = stmt.expression;
        if (call && call.type === 'CallExpression') {
          const callee = this.calleeName(call);
          if (callee && !callee.method && SCRUBBERS.has(callee.name)) {
            return call.arguments
              .map((a) => this.pathOf(a))
              .filter(Boolean)
              .map((path) => ({ path, prefix: true }));
          }
        }
        return null;
      }
      case 'IfStatement':
        return this.ifStatement(stmt, scope);
      case 'WhileStatement': {
        this.booleanContext(stmt.condition, scope);
        this.evaluate(stmt.condition, scope);
        const g = this.guardsOf(stmt.condition, scope);
        const added = this.applyGuards(g.whenTrue);
        this.block(stmt.body, new Scope(scope));
        this.releaseGuards(added);
        return null;
      }
      case 'RepeatStatement':
        this.block(stmt.body, new Scope(scope));
        this.booleanContext(stmt.condition, scope);
        this.evaluate(stmt.condition, scope);
        return null;
      case 'DoStatement':
        this.block(stmt.body, new Scope(scope));
        return null;
      case 'ReturnStatement':
        // Returning a secret is not on the forbidden list.
        for (const a of stmt.arguments || []) {
          this.evaluate(a, scope);
          this.markUse(this.taintOf(a, scope), true);
        }
        return null;
      case 'ForNumericStatement': {
        for (const k of ['start', 'end', 'step']) if (stmt[k]) this.evaluate(stmt[k], scope);
        const inner = new Scope(scope);
        inner.declare(stmt.variable.name, null);
        const counter = !this.loopCounters.has(stmt.variable.name);
        if (counter) this.loopCounters.add(stmt.variable.name);
        this.block(stmt.body, inner);
        if (counter) this.loopCounters.delete(stmt.variable.name);
        return null;
      }
      case 'ForGenericStatement': {
        for (const it of stmt.iterators) this.evaluate(it, scope);
        const inner = new Scope(scope);
        // `for k, v in pairs(secretTable)` is already reported at the pairs() call site.
        for (const v of stmt.variables) inner.declare(v.name, null);
        this.block(stmt.body, inner);
        return null;
      }
      case 'FunctionDeclaration': {
        this.functionBody(stmt, scope, []);
        return null;
      }
      case 'BreakStatement':
      case 'LabelStatement':
      case 'GotoStatement':
        return null;
      default:
        if (stmt.expression) this.evaluate(stmt.expression, scope);
        return null;
    }
  }

  ifStatement(stmt, scope) {
    let earlyExit = null;
    for (const clause of stmt.clauses) {
      if (clause.condition) {
        this.booleanContext(clause.condition, scope);
        this.evaluate(clause.condition, scope);
      }
      const g = clause.condition ? this.guardsOf(clause.condition, scope) : { whenTrue: [], whenFalse: [] };
      const marks = clause.type === 'ElseClause' ? this.elseGuards(stmt) : g.whenTrue;
      const added = this.applyGuards(marks);
      this.block(clause.body, new Scope(scope));
      this.releaseGuards(added);

      // `if <cond> then return end` guards the remainder of the enclosing block.
      if (clause.condition && clause.type === 'IfClause' && stmt.clauses.length === 1 && exits(clause.body)) {
        earlyExit = g.whenFalse;
      }
    }
    return earlyExit;
  }

  elseGuards(stmt) {
    const marks = [];
    for (const c of stmt.clauses) {
      if (!c.condition) continue;
      marks.push(...this.guardsOf(c.condition, new Scope(null)).whenFalse);
    }
    return marks;
  }

  assignment(stmt, scope, isLocal) {
    const targets = stmt.variables;
    const inits = stmt.init || [];
    for (const init of inits) if (init.type !== 'FunctionDeclaration') this.evaluate(init, scope);

    // Indexed assignment onto a secret is itself a violation.
    if (!isLocal) {
      for (const t of targets) {
        if (t.type === 'MemberExpression' || t.type === 'IndexExpression') {
          const baseTaint = this.taintOf(t.base, scope);
          if (baseTaint && !baseTaint.container && !baseTaint.structure) {
            this.report(this.ruleFor('WSL005', baseTaint), t, `indexed assignment on a secret value: ${this.describe(baseTaint)}`, {
              taint: baseTaint,
            });
          }
          if (t.type === 'IndexExpression') {
            const keyTaint = this.taintOf(t.index, scope);
            if (keyTaint) {
              this.report(this.ruleFor('WSL005', keyTaint), t.index, `secret value used as a table key: ${this.describe(keyTaint)}`, {
                taint: keyTaint,
              });
            }
          }
        }
      }
    }

    targets.forEach((target, i) => {
      let taint = null;
      if (i < inits.length - 1 || inits.length === targets.length) {
        const init = inits[i];
        if (init && init.type === 'FunctionDeclaration') {
          const name = target.type === 'Identifier' ? target.name : this.pathOf(target);
          if (name) this.localFns.set(name, { node: init, secretReturns: null });
          this.functionBody(init, scope, []);
          taint = null;
        } else {
          taint = init ? this.taintOf(init, scope) : null;
        }
      } else if (inits.length) {
        const last = inits[inits.length - 1];
        const offset = i - (inits.length - 1);
        taint = this.multiReturnTaint(last, offset, scope);
      }

      if (taint) {
        taint = { ...taint, bindingId: this.bindingSeq++ };
        this.bindings.set(taint.bindingId, { taint, node: target, uses: 0, unverified: 0 });
      }

      if (target.type === 'Identifier') {
        if (isLocal) scope.declare(target.name, taint);
        else scope.set(target.name, taint);
        this.cleared.delete(target.name);
      } else {
        const path = this.pathOf(target);
        if (path) {
          if (taint) this.fieldTaint.set(path, taint);
          else this.fieldTaint.delete(path);
          this.cleared.delete(path);
        }
      }
      if (this.patch121) this.trackPatchState(target, i < inits.length ? inits[i] : null, scope);
    });
    return null;
  }

  multiReturnTaint(node, index, scope) {
    if (index === 0) return this.taintOf(node, scope);
    if (!node || node.type !== 'CallExpression') return null;
    const callee = this.calleeName(node);
    if (!callee || callee.method) return null;
    const entry = this.apiEntry(callee.name);
    if (!entry) return null;
    return this.returnTaint(callee.name, entry, index, node);
  }

  /** Walk an expression, reporting every forbidden operation it performs. */
  evaluate(node, scope) {
    if (!node || typeof node !== 'object') return;
    switch (node.type) {
      case 'BinaryExpression': {
        this.evaluate(node.left, scope);
        this.evaluate(node.right, scope);
        const lt = this.taintOf(node.left, scope);
        const rt = this.taintOf(node.right, scope);
        const t = lt ?? rt;
        if (!t) return;
        if (ARITHMETIC.has(node.operator)) {
          this.report(this.ruleFor('WSL001', t), lt ? node.left : node.right, `arithmetic on a secret value: ${this.describe(t)}`, { taint: t });
          if (lt && rt) this.markReported(rt);
        } else if (RELATIONAL.has(node.operator)) {
          this.report(this.ruleFor('WSL002', t), lt ? node.left : node.right, `comparison of a secret value: ${this.describe(t)}`, { taint: t });
          if (lt && rt) this.markReported(rt);
        } else if (node.operator === '..') {
          // Explicitly allowed by the wiki for string and number secrets.
          this.markUse(lt, true);
          this.markUse(rt, true);
        }
        return;
      }
      case 'LogicalExpression': {
        this.booleanContext(node.left, scope);
        this.evaluate(node.left, scope);
        // `and`/`or` short-circuit, so a guard in the left operand protects the right one.
        const g = this.guardsOf(node.left, scope);
        const added = this.applyGuards(node.operator === 'and' ? g.whenTrue : g.whenFalse);
        this.evaluate(node.right, scope);
        this.releaseGuards(added);
        return;
      }
      case 'UnaryExpression': {
        this.evaluate(node.argument, scope);
        const t = this.taintOf(node.argument, scope);
        if (!t) return;
        if (node.operator === '#') {
          this.report(this.ruleFor('WSL004', t), node.argument, `length operator (#) on a secret value: ${this.describe(t)}`, { taint: t });
        } else if (node.operator === '-') {
          this.report(this.ruleFor('WSL001', t), node.argument, `arithmetic on a secret value: ${this.describe(t)}`, { taint: t });
        } else if (node.operator === 'not') {
          this.booleanTest(node.argument, t);
        }
        return;
      }
      case 'MemberExpression':
      case 'IndexExpression': {
        this.evaluate(node.base, scope);
        if (node.type === 'IndexExpression') this.evaluate(node.index, scope);
        const baseTaint = this.taintOf(node.base, scope);
        if (baseTaint && !baseTaint.container && !baseTaint.structure) {
          if (baseTaint.category && this.guardArgDepth > 0) {
            this.markUse(baseTaint, true);
          } else {
            this.report(this.ruleFor('WSL005', baseTaint), node, `indexed access on a secret value: ${this.describe(baseTaint)}`, {
              taint: baseTaint,
            });
          }
        }
        if (node.type === 'IndexExpression') {
          const keyTaint = this.taintOf(node.index, scope);
          if (keyTaint) {
            this.report(this.ruleFor('WSL005', keyTaint), node.index, `secret value used as a table key: ${this.describe(keyTaint)}`, {
              taint: keyTaint,
            });
          }
        }
        return;
      }
      case 'TableConstructorExpression':
        for (const f of node.fields) {
          if (f.type === 'TableKey') {
            this.evaluate(f.key, scope);
            const kt = this.taintOf(f.key, scope);
            if (kt) {
              this.report('WSL005', f.key, `secret value used as a table key: ${this.describe(kt)}`, { taint: kt });
            }
          }
          if (f.value) {
            this.evaluate(f.value, scope);
            this.markUse(this.taintOf(f.value, scope), true);
          }
        }
        return;
      case 'FunctionDeclaration':
        this.functionBody(node, scope, []);
        return;
      case 'CallExpression':
      case 'StringCallExpression':
      case 'TableCallExpression':
        this.call(node, scope);
        return;
      default:
        return;
    }
  }

  call(node, scope) {
    const args =
      node.type === 'CallExpression'
        ? node.arguments
        : node.type === 'StringCallExpression'
          ? [node.argument]
          : [node.argument];
    const callee = this.calleeName(node);

    // Calling a secret value as if it were a function.
    if (node.base && (node.base.type === 'Identifier' || node.base.type === 'MemberExpression' || node.base.type === 'IndexExpression')) {
      const baseIsMethod = node.base.type === 'MemberExpression' && node.base.indexer === ':';
      const target = baseIsMethod ? node.base.base : node.base;
      const t = baseIsMethod ? null : this.taintOf(target, scope);
      if (t && !t.container) {
        this.report(this.ruleFor('WSL003', t), node.base, `call of a secret value as-if it were a function: ${this.describe(t)}`, {
          taint: t,
        });
      }
      if (baseIsMethod) this.evaluate(node.base.base, scope);
      else if (node.base.type !== 'Identifier') this.evaluate(node.base, scope);
    }

    // AddAuraGroup and friends hand an AuraButton to their initializeFrame callback, so tag
    // that parameter before the callback body is analysed, and untag it afterwards.
    const buttonParams = this.patch121 ? this.tagInitializeFrameParams(callee, args) : [];
    // `issecretvalue(aura.name)` indexes the aura in order to test it; that read is the
    // guard idiom DBM and BigWigs ship, not a violation.
    const guardCall =
      callee && (this.guardShape(callee) || (!callee.method && SCRUBBERS.has(callee.name)));
    if (guardCall) this.guardArgDepth += 1;
    for (const a of args) this.evaluate(a, scope);
    if (guardCall) this.guardArgDepth -= 1;
    for (const p of buttonParams) this.widgetOf.delete(p);

    if (!callee) return;
    const name = callee.name;

    // WSL008: registering a combat-log event errors on registration in 12.0.
    if (name === 'RegisterEvent' || name === 'RegisterUnitEvent') {
      for (const a of args) {
        const s = stringValue(a);
        if (s && COMBAT_LOG_EVENTS.has(s)) {
          this.report('WSL008', a, `${s} errors when registered in 12.0; ${COMBAT_LOG_REPLACEMENT}`);
        }
      }
    }

    if (this.patch121) {
      if (!callee.method) {
        const removed = REMOVED_CALLS[name];
        if (removed) this.report(removed.ruleId, node, removed.message);
        if (name === 'CreateFrame') this.checkCreateFrameTemplates(args);
        // The call errors outright, so this fires even where the result is guarded.
        if (AURA_ERRORING_CALLS.has(name)) {
          this.report(
            'WSL018',
            node,
            `${name}() reaches aura data by index, slot or instance id, which Lua errors while auras are secret (combat, encounters, M+, PvP); ${AURA_SUGGESTION}`
          );
        }
      } else {
        const recvNode = node.base ? node.base.base : null;
        const recv = recvNode ? this.pathOf(recvNode) : null;
        const widgetType = recvNode ? this.widgetKindOf(recvNode, scope) : null;
        const aspectMethods = widgetType ? FORBIDDEN_ASPECT_METHODS[widgetType] : null;
        const forbidden = aspectMethods ? aspectMethods[name] : null;
        if (forbidden) {
          this.report(
            'WSL017',
            node,
            `${forbidden.verb} on an ${widgetType} is disallowed by its ${forbidden.aspect} forbidden aspect: ${recv}:${name}()`
          );
        }
        if (this.patch1215) {
          this.applyPandemicAspects(name, args);
          this.check1215(node, name, recvNode, widgetType, args, scope);
        }
      }
    }

    const argTaints = args.map((a) => this.taintOf(a, scope));

    if (this.patch121 && !callee.method && ITERATORS.has(name)) {
      for (let i = 0; i < args.length; i++) {
        const t = argTaints[i];
        if (t && t.category) {
          this.report(CATEGORY_RULES[t.category], args[i], `iteration with ${name}() over a secret value: ${this.describe(t)}`, { taint: t });
        }
      }
    }

    if (!callee.method && SCRUBBERS.has(name)) {
      for (const t of argTaints) this.markUse(t, true);
      return;
    }
    if (ALLOWED_SINKS.has(name) || this.guardShape(callee)) {
      for (const t of argTaints) this.markUse(t, true);
      return;
    }
    if (!callee.method && name === 'tostring') {
      for (let i = 0; i < args.length; i++) {
        const t = argTaints[i];
        if (t) this.report('WSL011', args[i], `tostring() on a secret value: ${this.describe(t)}`, { taint: t });
      }
      return;
    }

    const entry = callee.method ? null : this.apiEntry(name);
    if (entry) {
      if (this.patch121) this.checkRenamedStructFields(entry, args);
      const sa = entry.secretArguments;
      for (let i = 0; i < args.length; i++) {
        const t = argTaints[i];
        if (!t || t.container) continue;
        if (sa === 'NotAllowed') {
          this.report('WSL006', args[i], `secret value passed to ${name}(), which is documented SecretArguments = "NotAllowed": ${this.describe(t)}`, { taint: t });
        } else if (sa === 'AllowedWhenUntainted') {
          this.report('WSL006', args[i], `secret value passed to ${name}(), which is documented SecretArguments = "AllowedWhenUntainted" and addon code is always tainted: ${this.describe(t)}`, { taint: t });
        } else {
          this.markUse(t, true);
        }
      }
      return;
    }

    const local = !callee.method ? this.localFns.get(name) : null;
    if (local) {
      this.crossBoundary(local, name, args, argTaints, node, scope);
      return;
    }

    // Unknown callee (widget method, external library). Blizzard's design allows secrets to
    // flow into widget setters, so this is a tracked-but-unverified use, not a violation.
    for (const t of argTaints) this.markUse(t, false);
  }

  // ----------------------------------------------------------- patch 12.1.5 checks

  /**
   * A string this file can resolve: a literal, a `local NAME = "..."`, or a concatenation of
   * those. A numeric for-loop counter folds to "1", so `"ActionButton" .. i .. "Cooldown"`
   * resolves to a name of the right shape; nothing that consumes the result cares which
   * digit it was.
   */
  constString(node) {
    if (!node) return null;
    const lit = stringValue(node);
    if (lit !== null) return lit;
    if (node.type === 'NumericLiteral') return String(node.value);
    if (node.type === 'Identifier' && this.loopCounters.has(node.name)) return '1';
    if (node.type === 'BinaryExpression' && node.operator === '..') {
      const left = this.constString(node.left);
      const right = this.constString(node.right);
      return left !== null && right !== null ? left + right : null;
    }
    const path = node.type === 'Identifier' ? node.name : this.pathOf(node);
    return path && this.stringConst.has(path) ? this.stringConst.get(path) : null;
  }

  /** The global an expression names, whether written `Foo` or `_G["Foo"]`. */
  globalName(node) {
    if (!node) return null;
    if (node.type === 'Identifier') return node.name;
    const viaG =
      (node.type === 'IndexExpression' || node.type === 'MemberExpression') &&
      node.base.type === 'Identifier' &&
      node.base.name === '_G';
    if (!viaG) return null;
    return node.type === 'MemberExpression' ? node.identifier.name : this.constString(node.index);
  }

  /**
   * The widget kind of a receiver expression: a local this file has typed, one of Blizzard's
   * action-button cooldowns named directly or through `_G`, or one reached as the cooldown
   * field of one of those buttons.
   */
  widgetKindOf(node, scope) {
    if (!node) return null;
    const path = this.pathOf(node);
    if (path && this.widgetOf.has(path)) return this.widgetOf.get(path);
    if (!this.patch1215) return null;
    // A local or parameter that happens to share a Blizzard frame's name is not that frame.
    if (node.type === 'Identifier' && scope && scope.lookupScope(node.name)) return null;
    const global = this.globalName(node);
    if (global && PROTECTED_COOLDOWN_GLOBAL.test(global)) return 'ProtectedCooldown';
    if (global && PROTECTED_BUTTON_GLOBAL.test(global)) return 'ProtectedButton';
    if (node.type === 'MemberExpression' && COOLDOWN_FIELDS.has(node.identifier.name)) {
      if (this.widgetKindOf(node.base, scope) === 'ProtectedButton') return 'ProtectedCooldown';
    }
    return null;
  }

  /** What the snapshot records about one method of one documented widget system. */
  widgetMethod(system, name) {
    const bucket = this.api.widgets ? this.api.widgets[system] : null;
    return bucket && Object.prototype.hasOwnProperty.call(bucket, name) ? bucket[name] : null;
  }

  /**
   * The widget kind a CreateFrame call produces. AuraContainer/AuraButton come from the
   * frame type (12.1); a Cooldown built from a secure template is protected at creation,
   * which is the only way an addon makes one (12.1.5).
   */
  createFrameKind(args) {
    const frameType = stringValue(args[0]);
    if (frameType && ASPECT_FRAME_TYPES.has(frameType)) return frameType;
    if (!this.patch1215 || frameType !== 'Cooldown') return null;
    const templates = this.constString(args[3]);
    const secure = templates && templates.split(',').some((t) => isProtectedTemplate(t.trim()));
    return secure ? 'ProtectedCooldown' : null;
  }

  /** The kind an animation factory call produces, e.g. `button:CreateAnimationGroup()`. */
  animationKindFrom(node, scope) {
    const callee = this.calleeName(node);
    if (!callee || !callee.method) return null;
    const produced = ANIMATION_FACTORIES[callee.name];
    if (!produced) return null;
    const receiverKind = this.widgetKindOf(node.base.base, scope);
    return PANDEMIC_KINDS.has(receiverKind) ? `Pandemic${produced}` : produced;
  }

  /**
   * Handlers installed with `hooksecurefunc(getmetatable(<a Cooldown>).__index, name, fn)`
   * run for every Cooldown in the game, the protected action-button ones included, so their
   * first parameter is a cooldown that may be protected. Hooking a protected cooldown frame
   * directly counts too, and `local mt = getmetatable(X).__index` is followed.
   */
  collectCooldownHooks(root) {
    const inits = new Map();
    walk(root, (n) => {
      if (n.type !== 'LocalStatement') return;
      n.variables.forEach((v, i) => {
        if (v.type === 'Identifier' && n.init && n.init[i]) inits.set(v.name, n.init[i]);
      });
    });
    const cooldownLike = (node) => {
      if (!node) return false;
      const global = this.globalName(node);
      if (global && PROTECTED_COOLDOWN_GLOBAL.test(global)) return true;
      const init = node.type === 'Identifier' ? inits.get(node.name) : node;
      if (!init || init.type !== 'CallExpression') return false;
      const callee = this.calleeName(init);
      return !!callee && !callee.method && callee.name === 'CreateFrame' && stringValue(init.arguments[0]) === 'Cooldown';
    };
    // `local Frame = Frame` is a common upvalue cache; the seen set stops it looping.
    const hooksCooldowns = (target, seen = new Set()) => {
      if (!target) return false;
      if (target.type === 'Identifier' && inits.has(target.name)) {
        if (seen.has(target.name)) return false;
        seen.add(target.name);
        return hooksCooldowns(inits.get(target.name), seen);
      }
      if (target.type === 'MemberExpression' && target.identifier.name === '__index' && target.base.type === 'CallExpression') {
        const callee = this.calleeName(target.base);
        return !!callee && !callee.method && callee.name === 'getmetatable' && cooldownLike(target.base.arguments[0]);
      }
      const global = this.globalName(target);
      return !!global && PROTECTED_COOLDOWN_GLOBAL.test(global);
    };
    walk(root, (n) => {
      if (n.type !== 'CallExpression' || n.arguments.length < 3) return;
      const callee = this.calleeName(n);
      if (!callee || callee.method || callee.name !== 'hooksecurefunc') return;
      if (!hooksCooldowns(n.arguments[0])) return;
      const handler = n.arguments[2];
      if (handler.type === 'FunctionDeclaration') this.hookedHandlers.add(handler);
      else {
        const name = this.pathOf(handler);
        if (name) this.hookedHandlerNames.add(name);
      }
    });
  }

  /** The name a hooked handler receives the cooldown under: `self` for `function T:fn()`, else its first parameter. */
  hookedSelfOf(fnNode) {
    const byName = fnNode.identifier ? this.pathOf(fnNode.identifier) : null;
    if (!this.hookedHandlers.has(fnNode) && !(byName && this.hookedHandlerNames.has(byName))) return null;
    if (fnNode.identifier && fnNode.identifier.type === 'MemberExpression' && fnNode.identifier.indexer === ':') return 'self';
    const first = (fnNode.parameters || [])[0];
    return first && first.type === 'Identifier' ? first.name : null;
  }

  /**
   * `button:AddPandemicActiveAnimation(group)` and its two siblings are what apply the new
   * aspects, to the group and to the animations already inside it. Nothing else does, which
   * is why Blizzard's own sample builds the group first and registers it last.
   */
  applyPandemicAspects(name, args) {
    if (!PANDEMIC_ANIMATION_METHODS.has(name)) return;
    for (const a of args) {
      const group = this.pathOf(a);
      if (!group) continue;
      this.widgetOf.set(group, 'PandemicAnimationGroup');
      for (const [child, owner] of this.animationOwner) {
        if (owner === group && this.widgetOf.get(child) === 'Animation') {
          this.widgetOf.set(child, 'PandemicAnimation');
        }
      }
    }
  }

  /**
   * WSL019/WSL020/WSL021. Which methods carry which forbidden aspect, and which cooldown
   * methods are protected, both come from the snapshot; this only decides whether the object
   * the method is called on is one that carries them.
   */
  check1215(node, name, recvNode, kind, args, scope) {
    if (!kind) return;
    // `_G["ActionButton" .. i .. "Cooldown"]` has no path; say what was written instead.
    const recv = this.pathOf(recvNode) ?? (this.globalName(recvNode) ? '_G[...]' : null);
    const callee = recv ? `${recv}:${name}` : name;

    if (kind === 'ProtectedCooldown' || kind === 'HookedCooldown') {
      const meta = this.widgetMethod(COOLDOWN_SYSTEM, name);
      if (!meta || !meta.protected || (recv && this.unprotected.has(recv))) return;
      const why =
        kind === 'HookedCooldown'
          ? `runs in a handler hooksecurefunc installed on the Cooldown widget type, so it runs for the protected action-button cooldowns too, where tainted code cannot call it in 12.1.5; ${HOOK_SUGGESTION}`
          : `cannot be called from tainted code in 12.1.5 because the cooldown frame itself is protected; ${COOLDOWN_SUGGESTION}`;
      this.report('WSL021', node, `${callee}() ${why}`);
      return;
    }

    const system = ANIMATION_SYSTEMS[kind];
    const meta = system ? this.widgetMethod(system, name) : null;
    for (const check of (meta && meta.aspects) || []) {
      const rule = NEW_ASPECT_RULES[check.aspect];
      if (!rule) continue; // ScriptBindings and ChangeAnimationTarget predate 12.1.5
      if (check.argument === 'self') {
        if (!PANDEMIC_KINDS.has(kind)) continue;
        this.report(
          rule.ruleId,
          node,
          `${rule.verb} ${describeAnimation(kind)} is disallowed by its ${check.aspect} forbidden aspect: ${callee}()`
        );
        continue;
      }
      const argNode = args[check.index];
      const argKind = argNode ? this.widgetKindOf(argNode, scope) : null;
      if (!PANDEMIC_KINDS.has(argKind)) continue;
      this.report(
        rule.ruleId,
        argNode,
        `${rule.argVerb} ${describeAnimation(argKind)} is disallowed by its ${check.aspect} forbidden aspect: ` +
          `${callee}(${this.pathOf(argNode) ?? ''})`
      );
    }
  }

  // ------------------------------------------------------------- patch 12.1 checks

  /**
   * True when the unit token keeps this identity API non-secret (see rules.mjs). Addons
   * routinely hold the token in a constant (`local PLAYER = "player"`), so resolve an
   * identifier back to its string value before deciding.
   */
  selfExempt(name, node) {
    const arg = node && Array.isArray(node.arguments) ? node.arguments[0] : null;
    let token = stringValue(arg);
    if (token === null && arg && arg.type === 'Identifier') {
      token = this.stringConst.has(arg.name) ? this.stringConst.get(arg.name) : null;
    }
    if (token === null) return false;
    if (AURA_STATE_IDENTITY_APIS.has(name)) return SELF_EXEMPT_TOKENS.has(token);
    return token === 'player';
  }

  /** Tag initializeFrame callback parameters as AuraButtons; returns the names to untag. */
  tagInitializeFrameParams(callee, args) {
    if (!callee || !callee.method || !AURA_GROUP_METHODS.has(callee.name)) return [];
    const tagged = [];
    for (const a of args) {
      if (!a || a.type !== 'TableConstructorExpression') continue;
      for (const f of a.fields) {
        if (f.type !== 'TableKeyString' || f.key.name !== 'initializeFrame') continue;
        if (!f.value || f.value.type !== 'FunctionDeclaration') continue;
        const p = f.value.parameters && f.value.parameters[0];
        if (p && p.type === 'Identifier' && !this.widgetOf.has(p.name)) {
          this.widgetOf.set(p.name, 'AuraButton');
          tagged.push(p.name);
        }
      }
    }
    return tagged;
  }

  /** WSL014: a CreateFrame template list naming the removed SecureAuraHeaderTemplate. */
  checkCreateFrameTemplates(args) {
    for (const a of args) {
      const s = stringValue(a);
      if (!s || !s.includes(REMOVED_TEMPLATE)) continue;
      if (s.split(',').some((part) => part.trim() === REMOVED_TEMPLATE)) {
        this.report('WSL014', a, REMOVED_TEMPLATE_MESSAGE);
      }
    }
  }

  /**
   * WSL016: a field 12.1 renamed, passed inside a documented options structure. The old
   * name is ignored at runtime with no Lua error, which is why it needs a static check.
   */
  checkRenamedStructFields(entry, args) {
    const docArgs = entry.args || [];
    for (let i = 0; i < args.length && i < docArgs.length; i++) {
      const struct = docArgs[i] && docArgs[i].type ? this.api.structures[docArgs[i].type] : null;
      if (!struct || !struct.fields) continue;
      const passed =
        args[i].type === 'TableConstructorExpression'
          ? constructorFields(args[i])
          : args[i].type === 'Identifier'
            ? this.tableFields.get(args[i].name)
            : null;
      if (!passed) continue;
      for (const [oldField, newField] of Object.entries(RENAMED_STRUCT_FIELDS)) {
        if (!Object.prototype.hasOwnProperty.call(struct.fields, newField)) continue;
        const keyNode = passed.get(oldField);
        if (keyNode) {
          this.report(
            'WSL016',
            keyNode,
            `${oldField} was removed from ${docArgs[i].type} in 12.1 and is silently ignored (the cooldown swipe never shows); rename it to ${newField}, or move to an AuraContainer, which sources private auras too`
          );
        }
      }
    }
  }

  /** Keep the path -> widget-type and path -> table-fields maps in step with assignments. */
  trackPatchState(target, init, scope) {
    const path = target.type === 'Identifier' ? target.name : this.pathOf(target);
    if (!path) return;
    // `args.showCountdownFrame = true` after the constructor still counts as a field.
    if (target.type === 'MemberExpression') {
      const fields = this.tableFields.get(this.pathOf(target.base));
      if (fields) fields.set(target.identifier.name, target);
    }
    this.widgetOf.delete(path);
    this.tableFields.delete(path);
    this.stringConst.delete(path);
    this.animationOwner.delete(path);
    if (!init) return;
    // `local PLAYER = "player"` and `local name = prefix .. i .. "Cooldown"` both resolve.
    const constant = this.constString(init);
    if (constant !== null) {
      this.stringConst.set(path, constant);
      return;
    }
    if (init.type === 'TableConstructorExpression') {
      this.tableFields.set(path, constructorFields(init));
      return;
    }
    if (init.type === 'CallExpression') {
      const callee = this.calleeName(init);
      if (callee && !callee.method && callee.name === 'CreateFrame') {
        const kind = this.createFrameKind(init.arguments);
        if (kind) this.widgetOf.set(path, kind);
        return;
      }
      if (this.patch1215) {
        const animation = this.animationKindFrom(init, scope);
        if (animation) {
          this.widgetOf.set(path, animation);
          const owner = this.pathOf(init.base.base);
          if (owner && animation.endsWith('Animation')) this.animationOwner.set(path, owner);
        }
      }
      return;
    }
    // `self.buttons[i] = button` inside initializeFrame: carry the widget type to the
    // field so operations on it later are still checked. `_G["ActionButton1Cooldown"]` and
    // `button.cooldown` resolve here too, once 12.1.5 makes protected cooldowns interesting.
    const from = this.widgetKindOf(init, scope);
    if (from) this.widgetOf.set(path, from);
  }

  crossBoundary(local, name, args, argTaints, node, scope) {
    const tainted = argTaints.map((t, i) => (t ? i : -1)).filter((i) => i >= 0);
    if (!tainted.length) return;
    if (this.callDepth >= 1) {
      for (const i of tainted) this.markUse(argTaints[i], false);
      return;
    }
    const sig = `${name}:${tainted.join(',')}`;
    const before = this.findings.length;
    let paramBindings = new Map();
    if (!this.analysedWithTaint.has(sig)) {
      this.analysedWithTaint.add(sig);
      this.callDepth += 1;
      paramBindings = this.functionBody(
        local.node,
        scope,
        tainted.map((i) => ({ index: i, taint: argTaints[i] }))
      );
      this.callDepth -= 1;
    }
    const produced = this.findings.length > before;
    const params = local.node.parameters || [];
    for (const i of tainted) {
      const t = argTaints[i];
      if (produced) {
        this.markReported(t);
        continue;
      }
      const p = params[i];
      const guarded = p && p.type === 'Identifier' ? guardsParamIn(this, local.node, p.name) : false;
      const inner = paramBindings.get(i);
      // Passing a secret to a Lua function is explicitly allowed. Only warn when the callee
      // then hands it somewhere this analysis cannot verify, and never guards it.
      const escapes = inner ? inner.unverified > 0 : false;
      if (guarded || !escapes) {
        this.markUse(t, true);
      } else {
        this.report('WSL009', args[i], `secret value crosses into ${name}() with no guard on parameter ${p && p.name ? `'${p.name}'` : `#${i + 1}`}: ${this.describe(t)}`, { taint: t });
      }
    }
  }

  functionBody(fnNode, scope, taintedParams) {
    const inner = new Scope(scope);
    const params = fnNode.parameters || [];
    const paramBindings = new Map();
    const hookedSelf = this.hookedSelfOf(fnNode);
    if (hookedSelf) this.widgetOf.set(hookedSelf, 'HookedCooldown');
    params.forEach((p, i) => {
      if (p.type !== 'Identifier') return;
      const hit = taintedParams.find((tp) => tp.index === i);
      if (!hit) {
        inner.declare(p.name, null);
        return;
      }
      const bindingId = this.bindingSeq++;
      const taint = { ...hit.taint, label: p.name, bindingId };
      const record = { taint, node: p, uses: 0, unverified: 0, isParam: true };
      this.bindings.set(bindingId, record);
      paramBindings.set(i, record);
      inner.declare(p.name, taint);
    });
    this.hoistLocalFunctions(fnNode.body, inner);
    this.block(fnNode.body, inner);
    if (hookedSelf) this.widgetOf.delete(hookedSelf);
    if (!taintedParams.length) this.recordReturnTaint(fnNode, inner);
    return paramBindings;
  }

  recordReturnTaint(fnNode, scope) {
    const name = fnNode.identifier ? this.pathOf(fnNode.identifier) : null;
    if (!name) return;
    const rec = this.localFns.get(name);
    if (!rec) return;
    let found = null;
    walk(fnNode.body, (n) => {
      if (found) return false;
      if (n.type === 'FunctionDeclaration') return false; // nested function, not this one
      if (n.type !== 'ReturnStatement') return;
      for (const a of n.arguments || []) {
        const t = this.taintOf(a, scope);
        if (t) {
          found = t;
          return false;
        }
      }
    });
    if (found) rec.secretReturns = found;
  }

  // ---------------------------------------------------------- boolean tests

  booleanContext(node, scope) {
    if (!node) return;
    if (node.type === 'LogicalExpression') {
      this.booleanContext(node.left, scope);
      const g = this.guardsOf(node.left, scope);
      const added = this.applyGuards(node.operator === 'and' ? g.whenTrue : g.whenFalse);
      this.booleanContext(node.right, scope);
      this.releaseGuards(added);
      return;
    }
    if (node.type === 'UnaryExpression' && node.operator === 'not') {
      this.booleanContext(node.argument, scope);
      return;
    }
    if (node.type === 'BinaryExpression' || node.type === 'UnaryExpression') return;
    const t = this.taintOf(node, scope);
    if (t) this.booleanTest(node, t);
  }

  booleanTest(node, taint) {
    if (taint.container) return;
    // The 12.1 aura APIs return a table or nil, never a boolean, and nil-checking the
    // return is the sanctioned pattern, so a boolean test on aura taint stays silent.
    // (The AuraData structure left the generated docs in 12.1, so the type lookup below
    // cannot vouch for it any more.)
    if (taint.category === 'aura') {
      this.markUse(taint, true);
      return;
    }
    const sev = booleanTestSeverity(taint.type, this.api.structures);
    if (!sev) {
      this.markUse(taint, true);
      return;
    }
    const why =
      sev === 'error'
        ? `its documented return type is bool`
        : `its documented return type is unknown, so this may be a boolean secret`;
    this.report(this.ruleFor('WSL007', taint), node, `boolean test on a secret value (${why}): ${this.describe(taint)}`, {
      severity: sev,
      taint,
    });
  }

  // ------------------------------------------------------------- WSL010 bookkeeping

  markUse(taint, allowed) {
    if (!taint || taint.bindingId == null) return;
    const b = this.bindings.get(taint.bindingId);
    if (!b) return;
    b.uses += 1;
    if (!allowed) b.unverified += 1;
  }

  markReported(taint) {
    if (taint && taint.bindingId != null) this.reportedOrigins.add(taint.bindingId);
  }

  /**
   * WSL010: a conditionally secret value that is used somewhere this analysis cannot verify,
   * with no guard anywhere in its scope and no other finding raised for it.
   */
  reportUnguarded() {
    if (this.options.disable.has('WSL010')) return;
    if (this.options.conditional === 'off') return;
    for (const [id, b] of this.bindings) {
      if (this.reportedOrigins.has(id)) continue;
      if (b.isParam) continue;
      if (b.taint.kind !== 'conditional') continue;
      if (!b.unverified) continue;
      const label = b.node && b.node.type === 'Identifier' ? b.node.name : this.pathOf(b.node);
      if (label && this.guardsSomewhere(label)) continue;
      const why = b.taint.conditions ? b.taint.conditions.join(', ') : 'a runtime restriction';
      this.report(
        'WSL010',
        b.node,
        `${label ? `'${label}' ` : ''}derives from ${b.taint.origin}() which is secret while ${why} is active, and nothing in this scope guards it with issecretvalue/canaccessvalue`,
        { severity: 'warning' }
      );
    }
  }
}

/** True when `fnNode`'s own body guards or scrubs the named parameter. */
function guardsParamIn(analyzer, fnNode, paramName) {
  let found = false;
  walk(fnNode.body, (n) => {
    if (found) return false;
    if (n.type !== 'CallExpression') return;
    for (const p of analyzer.guardedPathsOf(n)) {
      if (p === paramName || p.startsWith(paramName + '.')) found = true;
    }
  });
  return found;
}

/** How a finding names an animation object that carries the 12.1.5 aspects. */
function describeAnimation(kind) {
  return kind === 'PandemicAnimation'
    ? 'an animation of a group registered with a Pandemic trigger'
    : 'an animation group registered with a Pandemic trigger';
}

function exits(body) {
  const last = body[body.length - 1];
  return !!last && (last.type === 'ReturnStatement' || last.type === 'BreakStatement');
}

/** String-keyed fields of a table constructor, mapped to their key nodes. */
function constructorFields(tableNode) {
  const fields = new Map();
  for (const f of tableNode.fields) {
    if (f.type === 'TableKeyString') fields.set(f.key.name, f.key);
    else if (f.type === 'TableKey') {
      const k = stringValue(f.key);
      if (k !== null) fields.set(k, f.key);
    }
  }
  return fields;
}

const INHERITS_ATTR = /\binherits\s*=\s*(["'])([^"']+)\1/gi;

/**
 * Check .xml markup for templates 12.1 removed. Frames inherit templates in XML, so a
 * Lua-only scan misses every addon that builds its aura header the declarative way.
 * @returns {object[]} findings
 */
export function analyzeXml(source, filePath, options = {}) {
  const disable = options.disable instanceof Set ? options.disable : new Set(options.disable ?? []);
  const patch = !options.patch || options.patch === 'auto' ? DEFAULT_PATCH : options.patch;
  if (!patchAtLeast(patch, '12.1')) return [];
  if (disable.has('WSL014')) return [];

  const findings = [];
  INHERITS_ATTR.lastIndex = 0;
  let m;
  while ((m = INHERITS_ATTR.exec(source)) !== null) {
    if (!m[2].split(',').some((t) => t.trim() === REMOVED_TEMPLATE)) continue;
    const before = source.slice(0, m.index);
    const line = before.split('\n').length;
    findings.push({
      file: filePath,
      line,
      column: m.index - before.lastIndexOf('\n'),
      severity: RULES.WSL014.severity,
      ruleId: 'WSL014',
      message: REMOVED_TEMPLATE_MESSAGE,
      api: null,
      conditions: null,
    });
  }
  return findings;
}

/**
 * Analyse one Lua source file. `options.imports` carries the widget kinds earlier files in
 * load order exported; `exports` in the result is this file's contribution for the next.
 * @returns {{ findings: object[], exports: Array<[string, string]>, parseError: object|null }}
 */
export function analyzeSource(source, filePath, api, options = {}) {
  const opts = {
    conditional: options.conditional ?? 'off',
    disable: options.disable instanceof Set ? options.disable : new Set(options.disable ?? []),
    secretGuards: new Set(options.secretGuards ?? []),
    accessGuards: new Set(options.accessGuards ?? []),
    strict: options.strict === true,
    // 'auto' is resolved from the .toc by lint(); a bare file has no .toc to read.
    patch: !options.patch || options.patch === 'auto' ? DEFAULT_PATCH : options.patch,
    imports: options.imports ?? [],
  };
  const parseOptions = { locations: true, ranges: false, comments: false, scope: false };
  let ast;
  try {
    ast = luaparse.parse(source, { ...parseOptions, luaVersion: '5.1' });
  } catch (strictError) {
    // WoW's Lua 5.1 accepts a semicolon after `break`, which stock 5.1 rejects. Blizzard's own
    // shipped code relies on it, so fall back to the 5.2 grammar before calling a file broken.
    try {
      ast = luaparse.parse(source, { ...parseOptions, luaVersion: '5.2' });
    } catch {
      ast = null;
    }
  }
  if (!ast) {
    let err;
    try {
      luaparse.parse(source, { ...parseOptions, luaVersion: '5.1' });
    } catch (e) {
      err = e;
    }
    const line = err.line ?? (err.loc && err.loc.line) ?? 0;
    const column = typeof err.column === 'number' ? err.column + 1 : 0;
    return {
      findings: [],
      exports: [],
      parseError: {
        file: filePath,
        line,
        column,
        message: String(err.message || err).replace(/^\[\d+:\d+\]\s*/, ''),
      },
    };
  }
  const analyzer = new Analyzer({ api, filePath, options: opts });
  const findings = analyzer.run(ast);
  return { findings, exports: analyzer.exportWidgets(), parseError: null };
}
