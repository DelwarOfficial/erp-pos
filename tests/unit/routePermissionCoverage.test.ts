import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import policy from '../../src/lib/permissions/routePolicy.json';

const root = path.resolve('src/app/api');
const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const handlers = readdirSync(root, { recursive: true, encoding: 'utf8' })
  .filter(file => file.endsWith('route.ts')).flatMap(file => {
    const source = ts.createSourceFile(file, readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true);
    return source.statements.filter(ts.isFunctionDeclaration)
      .filter(node => node.name && methods.has(node.name.text))
      .map(node => ({ file: file.replaceAll('\\', '/'), method: node.name!.text, node, source }));
  });
const catalogue = readFileSync('src/lib/permissions/catalogue.ts', 'utf8');
const grants = new Set([...catalogue.matchAll(/code: '([^']+)'/g)].map(match => match[1]));

describe('explicit per-method route authorization contract', () => {
  it('covers every HTTP handler, without stale entries or blanket route exceptions', () => {
    const key = (item: { file: string; method: string }) => `${item.method} ${item.file}`;
    expect(policy.map(key).sort()).toEqual(handlers.map(key).sort());
    expect(new Set(policy.map(key)).size).toBe(policy.length);
  });

  for (const entry of policy) {
    it(`${entry.method} ${entry.file}`, () => {
      const handler = handlers.find(item => item.file === entry.file && item.method === entry.method)!;
      const calls: ts.CallExpression[] = [];
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node)) calls.push(node);
        ts.forEachChild(node, visit);
      };
      visit(handler.node);
      const guards = calls.filter(call => call.expression.getText(handler.source) === 'requirePermission');
      const actual = [...new Set(guards.map(call => {
        const grant = call.arguments[1];
        expect(grant && ts.isStringLiteral(grant)).toBe(true);
        return (grant as ts.StringLiteral).text;
      }))];
      expect(actual).toEqual(entry.permissions);
      for (const grant of actual) expect(grants.has(grant), `Unknown permission ${grant}`).toBe(true);
      if (entry.exception) {
        expect(entry.permissions).toHaveLength(0);
        expect(entry.exception.length).toBeGreaterThan(20);
      } else {
        expect(actual.length).toBeGreaterThan(0);
        const auth = calls.find(call => call.expression.getText(handler.source) === 'authenticateRequest');
        expect(auth).toBeDefined();
        expect(auth!.pos).toBeLessThan(guards[0].pos);
        // Permission must be awaited, not started in the background.
        for (const guard of guards) expect(ts.isAwaitExpression(guard.parent)).toBe(true);
      }
    });
  }
});
