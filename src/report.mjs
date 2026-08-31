// Three reporters: stylish (human), json (machine), github (workflow annotations).

import { RULES } from './rules.mjs';

export const FORMATS = ['stylish', 'json', 'github'];

function pad(s, n) {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function counts(result) {
  let errors = 0;
  let warnings = 0;
  for (const f of result.findings) {
    if (f.severity === 'error') errors += 1;
    else warnings += 1;
  }
  return { errors, warnings };
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function formatStylish(result) {
  const lines = [];
  for (const w of result.warningsBeforeLint) lines.push(w);

  for (const pe of result.parseErrors) {
    lines.push(`${pe.file}:${pe.line}:${pe.column}  parse error  ${pe.message}`);
  }

  const rows = result.findings.map((f) => [
    `${f.file}:${f.line}:${f.column}`,
    f.severity,
    f.ruleId,
    f.message,
  ]);
  const w0 = Math.max(0, ...rows.map((r) => r[0].length));
  const w1 = Math.max(0, ...rows.map((r) => r[1].length));
  for (const r of rows) lines.push(`${pad(r[0], w0)}  ${pad(r[1], w1)}  ${r[2]}  ${r[3]}`);

  const { errors, warnings } = counts(result);
  if (result.parseErrors.length) {
    lines.push(`${plural(result.parseErrors.length, 'parse error')}, ${plural(errors, 'error')}, ${plural(warnings, 'warning')}`);
  } else {
    lines.push(`${plural(errors, 'error')}, ${plural(warnings, 'warning')}`);
  }
  return lines.join('\n');
}

export function formatJson(result) {
  const { errors, warnings } = counts(result);
  return JSON.stringify(
    {
      version: result.version,
      patch: result.patch,
      snapshot: {
        source: result.snapshot.source,
        generated: result.snapshot.generated,
        functionCount: result.snapshot.functionCount,
        secretReturnCount: result.snapshot.secretReturnCount,
        conditionalCount: result.snapshot.conditionalCount,
      },
      filesScanned: result.filesScanned,
      findings: result.findings,
      parseErrors: result.parseErrors,
      warnings: result.warningsBeforeLint,
      summary: { errors, warnings, parseErrors: result.parseErrors.length },
    },
    null,
    2
  );
}

/** GitHub Actions workflow-command annotations. */
export function formatGithub(result) {
  const lines = [];
  const esc = (s) =>
    String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A').replace(/:/g, '%3A').replace(/,/g, '%2C');
  for (const w of result.warningsBeforeLint) lines.push(`::warning::${esc(w)}`);
  for (const pe of result.parseErrors) {
    lines.push(`::error file=${pe.file},line=${pe.line},col=${pe.column}::${esc(`parse error: ${pe.message}`)}`);
  }
  for (const f of result.findings) {
    const level = f.severity === 'error' ? 'error' : 'warning';
    lines.push(
      `::${level} file=${f.file},line=${f.line},col=${f.column},title=${esc(`${f.ruleId} ${RULES[f.ruleId].summary}`)}::${esc(`${f.ruleId}: ${f.message}`)}`
    );
  }
  const { errors, warnings } = counts(result);
  lines.push(`::notice::${plural(errors, 'error')}, ${plural(warnings, 'warning')} from wow-secret-lint`);
  return lines.join('\n');
}

export function format(result, kind) {
  switch (kind) {
    case 'json':
      return formatJson(result);
    case 'github':
      return formatGithub(result);
    case 'stylish':
      return formatStylish(result);
    default:
      throw new Error(`unknown format "${kind}" (expected one of: ${FORMATS.join(', ')})`);
  }
}

export { counts };
