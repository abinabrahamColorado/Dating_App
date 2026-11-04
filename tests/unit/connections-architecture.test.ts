import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { it, expect } from 'vitest';
function nodes(root: ts.Node): ts.Node[] {
  const out: ts.Node[] = [];
  function visit(n: ts.Node) {
    out.push(n);
    ts.forEachChild(n, visit);
  }
  visit(root);
  return out;
}
function parse(path: string, source = readFileSync(path, 'utf8')) {
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
}
function calls(n: ts.Node, f: ts.SourceFile) {
  return nodes(n)
    .filter(ts.isCallExpression)
    .map((c) => c.expression.getText(f));
}
function storeGuards(source: string) {
  const f = parse('connections.ts', source),
    methods = nodes(f).filter(ts.isMethodDeclaration);
  const required: Record<string, string[]> = {
    member: ['this.accounts.withSession', 'lockedConnection'],
    view: ['this.member', 'this.refreshPlans', 'approvedProfileFields'],
    send: ['this.member', 'this.command'],
    deliverOne: ['lockedConnection'],
    deliverPending: ['this.deliverOne'],
    savePreferences: ['this.member', 'this.command'],
    options: ['this.member', 'this.context', 'this.command'],
    plan: ['this.member', 'this.refreshPlans', 'this.command'],
    calendar: ['this.member', 'this.refreshPlans'],
    maintain: ['lockedConnection', 'this.refreshPlans'],
  };
  for (const [name, guards] of Object.entries(required)) {
    const m = methods.find((m) => m.name.getText(f) === name);
    if (!m) throw Error(`Missing ${name}`);
    for (const c of guards)
      if (!calls(m, f).includes(c)) throw Error(`Missing guard ${name}: ${c}`);
  }
  expect(methods.map((m) => m.name.getText(f)).sort()).toEqual(
    [
      ...Object.keys(required),
      'command',
      'preferences',
      'context',
      'refreshPlans',
      'optionSnapshot',
    ].sort(),
  );
}
it('I-04 M4 architecture inventories every HTTP route and its guarded member or audited staff boundary', () => {
  const f = parse('apps/web/server/connections-api.ts'),
    expected: Record<string, string> = {
      'GET connections/:id': 'db.view',
      'POST connections/:id/messages': 'db.send',
      'POST connections/:id/preferences': 'db.savePreferences',
      'POST connections/:id/options': 'db.options',
      'POST connections/:id/plans': 'db.plan',
      'GET connections/:id/plans/:id/calendar': 'db.calendar',
      'GET ops/venues': 'venues.list',
      'POST ops/venues': 'venues.save',
    };
  const routes = nodes(f)
    .filter(ts.isIfStatement)
    .filter((n) => n.expression.getText(f).startsWith('route ==='));
  expect(routes).toHaveLength(Object.keys(expected).length);
  for (const r of routes) {
    const key = ((r.expression as ts.BinaryExpression).right as ts.StringLiteral).text;
    expect(expected[key]).toBeTruthy();
    expect(calls(r.thenStatement, f)).toContain(expected[key]);
  }
  const labels = nodes(f)
    .filter(ts.isPropertyAssignment)
    .filter((n) => ts.isStringLiteral(n.name) && /^(GET|POST) /.test(n.name.text));
  expect(labels.map((n) => (n.name as ts.StringLiteral).text).sort()).toEqual(
    Object.keys(expected).sort(),
  );
  const deferred = nodes(f)
    .filter(ts.isCallExpression)
    .find((n) => n.expression.getText(f) === 'after')!;
  expect(calls(deferred, f)).toContain('db.deliverOne');
  expect(calls(deferred, f)).toContain('requireSupportedClient');
});
it('I-04 M4 architecture refuses removal of any member read, send, delivery or plan policy guard', () => {
  const source = readFileSync('packages/db/src/connections.ts', 'utf8');
  storeGuards(source);
  for (const [from, to] of [
    ['this.member(', 'unguarded('],
    ['lockedConnection(', 'unguarded('],
    ['this.refreshPlans(', 'unguarded('],
  ])
    expect(() => storeGuards(source.replaceAll(from!, to!))).toThrow('Missing guard');
  const policy = parse('packages/db/src/connection-policy.ts');
  expect(calls(policy, policy)).toContain('isDenied');
  expect(policy.text).toContain('SELECT app.lock_pair($1,$2)');
  expect(policy.text.indexOf('SELECT app.lock_pair')).toBeLessThan(
    policy.text.indexOf("!isDenied(a, b, 'CONNECTION')"),
  );
  const venue = parse('packages/db/src/venues.ts');
  for (const m of nodes(venue).filter(ts.isMethodDeclaration)) {
    expect(calls(m, venue)).toContain('this.accounts.withSession');
    expect(calls(m, venue)).toContain('this.accounts.withStaff');
    expect(m.getText(venue)).toContain('INSERT INTO ops.audit');
  }
});
it('I-04 M4 architecture inventories all durable jobs with fresh delivery guards and revocation-only maintenance', () => {
  const f = parse('apps/worker/src/connections.ts'),
    jobs = nodes(f)
      .filter(ts.isCallExpression)
      .filter((n) => n.expression.getText(f) === 'boss.work');
  expect(jobs.map((j) => (j.arguments[0] as ts.StringLiteral).text).sort()).toEqual([
    'connections.deliver',
    'connections.maintain',
  ]);
  for (const j of jobs) {
    const name = (j.arguments[0] as ts.StringLiteral).text;
    expect(calls(j.arguments[1]!, f)).toContain(
      name.endsWith('deliver') ? 'db.deliverPending' : 'db.maintain',
    );
    if (name.endsWith('deliver'))
      expect(calls(j.arguments[1]!, f)).toContain('requireSupportedClient');
  }
  const source = readFileSync('packages/db/src/connections.ts', 'utf8');
  expect(source).not.toContain('learning.');
  expect(source).not.toMatch(/console\.|process\.stdout|logger\./);
});
