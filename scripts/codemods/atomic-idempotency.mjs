// Codemod for audit finding F-41.
//
// Rewrites
//
//   withIdempotency(PARAMS, async () => { return withTenant(CTX, async (tx) => BODY); })
//
// into
//
//   withTenant(CTX, async (tx) => withIdempotency(PARAMS, async () => BODY, tx))
//
// so the idempotency reservation is written by the business transaction rather
// than by the autocommit client beside it. With the old shape there were three
// independent commits -- reservation, business work, completion -- and a crash
// between the second and third left the key stuck at 'processing' for 24 hours
// although the work had succeeded.
//
// Works on the TypeScript AST, not on text patterns: the bodies being moved are
// arbitrarily nested, and brace-matching them with regular expressions is how a
// codemod silently corrupts a file. Anything that does not match the exact shape
// is reported and left untouched.
//
// Usage: node scripts/codemods/atomic-idempotency.mjs [--write] <files...>

import { readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';

const write = process.argv.includes('--write');
const files = process.argv.slice(2).filter(arg => arg !== '--write');

let changed = 0;
let skipped = 0;

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const edits = [];
  const unmatched = [];

  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'withIdempotency') {
      const rewrite = plan(node, source);
      if (rewrite) edits.push(rewrite);
      else unmatched.push(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1);
      return; // never rewrite nested calls inside one already planned
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  if (edits.length === 0) {
    skipped++;
    console.log(`SKIP  ${file}${unmatched.length ? `  (unmatched shape at line ${unmatched.join(', ')})` : ''}`);
    continue;
  }

  let output = text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
  }
  if (write) writeFileSync(file, output);
  changed++;
  console.log(`${write ? 'EDIT' : 'WOULD'}  ${file}  (${edits.length} call${edits.length > 1 ? 's' : ''})`
    + (unmatched.length ? `  unmatched at line ${unmatched.join(', ')}` : ''));
}

console.log(`\n${changed} file(s) ${write ? 'rewritten' : 'would be rewritten'}, ${skipped} skipped`);

/** Returns an edit for a withIdempotency call of the expected shape, or null. */
function plan(call, source) {
  // Already atomic: the transaction client is passed as a third argument.
  if (call.arguments.length !== 2) return null;
  const [params, work] = call.arguments;
  if (!ts.isArrowFunction(work) || work.parameters.length !== 0) return null;

  // The work function must be exactly `withTenant(...)`, either as an
  // expression body or as the single statement `return withTenant(...)`.
  let inner = null;
  if (ts.isBlock(work.body)) {
    if (work.body.statements.length !== 1) return null;
    const only = work.body.statements[0];
    if (!ts.isReturnStatement(only) || !only.expression) return null;
    inner = only.expression;
  } else {
    inner = work.body;
  }
  if (ts.isAwaitExpression(inner)) inner = inner.expression;
  if (!ts.isCallExpression(inner) || !ts.isIdentifier(inner.expression) || inner.expression.text !== 'withTenant') return null;

  const [ctx, txWork, ...rest] = inner.arguments;
  if (!ctx || !txWork || !ts.isArrowFunction(txWork) || txWork.parameters.length !== 1) return null;
  const txParam = txWork.parameters[0];
  if (!ts.isIdentifier(txParam.name)) return null;

  const txName = txParam.name.text;
  const isAsync = txWork.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
  const txParamText = txParam.getText(source);
  const bodyText = txWork.body.getText(source);
  const restText = rest.map(arg => `, ${arg.getText(source)}`).join('');

  const replacement =
    `withTenant(${ctx.getText(source)}, ${isAsync ? 'async ' : ''}(${txParamText}) =>\n`
    + `        withIdempotency(\n`
    + `          ${params.getText(source)},\n`
    + `          async () => ${bodyText},\n`
    + `          ${txName},\n`
    + `        )${restText})`;

  return { start: call.getStart(source), end: call.getEnd(), replacement };
}
