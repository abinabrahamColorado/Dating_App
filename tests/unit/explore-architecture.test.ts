import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
import { it, expect } from 'vitest';
function nodes(root: ts.Node): ts.Node[] {
  const result: ts.Node[] = [];
  function visit(n: ts.Node) {
    result.push(n);
    ts.forEachChild(n, visit);
  }
  visit(root);
  return result;
}
function parse(path: string, source = readFileSync(path, 'utf8')) {
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
}
function calls(node: ts.Node, file: ts.SourceFile) {
  return nodes(node)
    .filter(ts.isCallExpression)
    .map((n) => n.expression.getText(file));
}
function guards(source: string) {
  const f = parse('explore.ts', source),
    methods = nodes(f).filter(ts.isMethodDeclaration);
  const required: Record<string, string[]> = {
    generateIn: ['lockedExplorePair', 'this.reserve'],
    reserve: ['lockedExplorePair'],
    review: ['lockedExplorePair'],
    edit: ['lockedExplorePair', 'this.reserve'],
    deliverOne: ['this.opportunity', 'lockedExplorePair'],
    card: ['withMemberPair', 'approvedProfileFields'],
    decide: ['this.opportunity', 'lockedExplorePair'],
    sendOne: ['this.opportunity', 'lockedExplorePair', 'send'],
    deliverPending: ['this.deliverOne'],
    sendNotifications: ['this.sendOne'],
  };
  for (const [name, requiredCalls] of Object.entries(required)) {
    const method = methods.find((m) => m.name.getText(f) === name);
    if (!method) throw Error(`Missing ${name}`);
    for (const c of requiredCalls)
      if (!calls(method, f).includes(c)) throw Error(`Missing guard path ${name}: ${c}`);
  }
  expect(methods.map((m) => m.name.getText(f)).sort()).toEqual(
    [
      'staff',
      'command',
      'opportunity',
      'reserve',
      'generateIn',
      'generate',
      'generateScheduled',
      'batches',
      'review',
      'edit',
      'deliverOne',
      'deliverPending',
      'own',
      'card',
      'decide',
      'close',
      'capacity',
      'expireOne',
      'maintain',
      'sendOne',
      'sendNotifications',
    ].sort(),
  );
}
it('I-04 M3 architecture: every new route calls its classified store boundary and every job has a guarded or revocation-only path', () => {
  const f = parse('apps/web/server/explore-api.ts');
  const expected: Record<string, string> = {
    'GET explore': 'db.own',
    'POST explore/capacity': 'db.capacity',
    'GET explore/:id': 'db.card',
    'POST explore/:id/decide': 'db.decide',
    'POST explore/:id/close': 'db.close',
    'GET ops/explore': 'db.batches',
    'POST ops/explore': 'db.generate',
    'GET ops/explore/:id': 'db.review',
    'POST ops/explore/:id': 'db.edit',
  };
  const routes = nodes(f)
    .filter(ts.isIfStatement)
    .filter((n) => n.expression.getText(f).startsWith('route ==='));
  expect(routes).toHaveLength(Object.keys(expected).length);
  for (const route of routes) {
    const condition = route.expression as ts.BinaryExpression;
    const key = (condition.right as ts.StringLiteral).text;
    expect(expected[key]).toBeTruthy();
    expect(calls(route.thenStatement, f)).toContain(expected[key]);
  }
  const manifest = nodes(f)
    .filter(ts.isPropertyAssignment)
    .filter((n) => ts.isStringLiteral(n.name) && /^(GET|POST) /.test(n.name.text));
  expect(manifest.map((n) => (n.name as ts.StringLiteral).text).sort()).toEqual(
    Object.keys(expected).sort(),
  );
  const worker = parse('apps/worker/src/explore.ts');
  const jobs: Record<string, string> = {
    'explore.batch': 'db.generateScheduled',
    'explore.deliver': 'db.deliverPending',
    'explore.maintain': 'db.maintain',
    'explore.mail': 'db.sendNotifications',
  };
  for (const job of nodes(worker)
    .filter(ts.isCallExpression)
    .filter((n) => n.expression.getText(worker) === 'boss.work')) {
    const name = (job.arguments[0] as ts.StringLiteral).text,
      callback = job.arguments[1]!;
    expect(jobs[name]).toBeTruthy();
    expect(calls(callback, worker)).toContain(jobs[name]);
    if (name !== 'explore.maintain')
      expect(calls(callback, worker)).toContain('requireSupportedClient');
  }
});
it('I-04 M3 architecture: removing the locked policy at any disclosure stage fails the guard audit', () => {
  const source = readFileSync('packages/db/src/explore.ts', 'utf8');
  guards(source);
  expect(() => guards(source.replaceAll('lockedExplorePair(', 'unguardedPair('))).toThrow(
    'Missing guard path',
  );
  expect(() => guards(source.replace('return withMemberPair(', 'return unguarded('))).toThrow(
    'Missing guard path',
  );
  const policy = parse('packages/db/src/explore-policy.ts');
  const gate = nodes(policy).find(
    (n) => ts.isFunctionDeclaration(n) && n.name?.text === 'lockedExplorePair',
  )!;
  expect(calls(gate, policy)).toContain('isDenied');
  expect(gate.getText(policy)).toContain('SELECT app.lock_pair($1,$2)');
  for (const stage of ['RETRIEVAL', 'RESERVATION', 'DELIVERY', 'ACCEPTANCE'])
    expect(source).toContain(`'${stage}'`);
  // The shared profile allowlist cannot acquire another caller without review.
  const readers = readdirSync('packages/db/src')
    .filter(
      (p) =>
        p.endsWith('.ts') &&
        readFileSync(`packages/db/src/${p}`, 'utf8').includes('approvedProfileFields('),
    )
    .sort();
  expect(readers).toEqual(['explore.ts', 'member-access.ts']);
  const f = parse('packages/db/src/explore.ts');
  for (const name of ['own', 'capacity', 'close', 'maintain']) {
    const m = nodes(f).find((n) => ts.isMethodDeclaration(n) && n.name.getText(f) === name)!;
    expect(calls(m, f)).not.toContain('approvedProfileFields');
    expect(calls(m, f)).not.toContain('send');
  }
});
