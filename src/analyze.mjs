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
} from './rules.mjs';

const ARITHMETIC = new Set(['+', '-', '*', '/', '%', '^']);
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
  }

  // ---------------------------------------------------------------- findings

  report(ruleId, node, message, { severity, taint } = {}) {
    const rule = RULES[ruleId];
    let sev = severity ?? rule.severity;
    if (taint && taint.kind === 'conditional') {
      if (this.options.conditional === 'off') return;
      if (this.options.conditional === 'warn' && sev === 'error') sev = 'warning';
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

  makeTaint({ kind, origin, type, conditions, structure, label, bindingId, container }) {
    return {
      kind,
      origin,
      type: type ?? null,
      conditions: conditions ?? null,
      structure: structure ?? null,
      // A documented structure is not itself a secret; its unmarked fields are.
      container: container === true,
      label: label ?? null,
      bindingId: bindingId ?? null,
    };
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
      const g = this.guardShape(callee);
      if (!g) return empty;
      // `obj:HasSecretValues()` guards the receiver; `issecretvalue(x)` guards its arguments.
      const paths = node.arguments.map((a) => this.pathOf(a)).filter(Boolean);
      if (!paths.length && callee.method) {
        const recv = node.base && node.base.base ? this.pathOf(node.base.base) : null;
        if (recv) paths.push(recv);
      }
      if (!paths.length) return empty;
      const marks = paths.map((p) => ({ path: p, prefix: g.prefix }));
      return g.safeWhen ? { whenTrue: marks, whenFalse: [] } : { whenTrue: [], whenFalse: marks };
    }
    return empty;
  }

  applyGuards(marks) {
    const added = [];
    for (const m of marks) {
      if (!this.cleared.has(m.path)) {
        this.cleared.add(m.path);
        added.push(m.path);
      }
    }
    return added;
  }

  releaseGuards(added) {
    for (const p of added) this.cleared.delete(p);
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
    const scope = new Scope(null);
    this.hoistLocalFunctions(ast.body, scope);
    this.block(ast.body, scope);
    this.reportUnguarded();
    this.findings.sort((a, b) => a.line - b.line || a.column - b.column || a.ruleId.localeCompare(b.ruleId));
    return this.findings;
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
    for (const stmt of body) {
      const trailing = this.statement(stmt, scope);
      if (trailing && trailing.length) this.applyGuards(trailing);
    }
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
        this.block(stmt.body, inner);
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
            this.report('WSL005', t, `indexed assignment on a secret value: ${this.describe(baseTaint)}`, {
              taint: baseTaint,
            });
          }
          if (t.type === 'IndexExpression') {
            const keyTaint = this.taintOf(t.index, scope);
            if (keyTaint) {
              this.report('WSL005', t.index, `secret value used as a table key: ${this.describe(keyTaint)}`, {
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
          this.report('WSL001', lt ? node.left : node.right, `arithmetic on a secret value: ${this.describe(t)}`, { taint: t });
          if (lt && rt) this.markReported(rt);
        } else if (RELATIONAL.has(node.operator)) {
          this.report('WSL002', lt ? node.left : node.right, `comparison of a secret value: ${this.describe(t)}`, { taint: t });
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
          this.report('WSL004', node.argument, `length operator (#) on a secret value: ${this.describe(t)}`, { taint: t });
        } else if (node.operator === '-') {
          this.report('WSL001', node.argument, `arithmetic on a secret value: ${this.describe(t)}`, { taint: t });
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
          this.report('WSL005', node, `indexed access on a secret value: ${this.describe(baseTaint)}`, {
            taint: baseTaint,
          });
        }
        if (node.type === 'IndexExpression') {
          const keyTaint = this.taintOf(node.index, scope);
          if (keyTaint) {
            this.report('WSL005', node.index, `secret value used as a table key: ${this.describe(keyTaint)}`, {
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
        this.report('WSL003', node.base, `call of a secret value as-if it were a function: ${this.describe(t)}`, {
          taint: t,
        });
      }
      if (baseIsMethod) this.evaluate(node.base.base, scope);
      else if (node.base.type !== 'Identifier') this.evaluate(node.base, scope);
    }

    for (const a of args) this.evaluate(a, scope);

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

    const argTaints = args.map((a) => this.taintOf(a, scope));

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
    const sev = booleanTestSeverity(taint.type, this.api.structures);
    if (!sev) {
      this.markUse(taint, true);
      return;
    }
    const why =
      sev === 'error'
        ? `its documented return type is bool`
        : `its documented return type is unknown, so this may be a boolean secret`;
    this.report('WSL007', node, `boolean test on a secret value (${why}): ${this.describe(taint)}`, {
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

function exits(body) {
  const last = body[body.length - 1];
  return !!last && (last.type === 'ReturnStatement' || last.type === 'BreakStatement');
}

/**
 * Analyse one Lua source file.
 * @returns {{ findings: object[], parseError: object|null }}
 */
export function analyzeSource(source, filePath, api, options = {}) {
  const opts = {
    conditional: options.conditional ?? 'off',
    disable: options.disable instanceof Set ? options.disable : new Set(options.disable ?? []),
    secretGuards: new Set(options.secretGuards ?? []),
    accessGuards: new Set(options.accessGuards ?? []),
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
      parseError: {
        file: filePath,
        line,
        column,
        message: String(err.message || err).replace(/^\[\d+:\d+\]\s*/, ''),
      },
    };
  }
  const analyzer = new Analyzer({ api, filePath, options: opts });
  return { findings: analyzer.run(ast), parseError: null };
}
