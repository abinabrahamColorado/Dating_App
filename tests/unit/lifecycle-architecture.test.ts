import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { it, expect } from 'vitest';
function nodes(root: ts.Node) {
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
function calls(node: ts.Node, f: ts.SourceFile) {
  return nodes(node)
    .filter(ts.isCallExpression)
    .map((c) => c.expression.getText(f));
}
function guards(source: string) {
  const f = parse('feedback.ts', source),
    methods = nodes(f).filter(ts.isMethodDeclaration);
  const expected = [
    'command',
    'maintain',
    'list',
    'present',
    'answer',
    'invite',
    'secondMeeting',
    'exit',
    'followups',
    'followup',
    'attention',
    'attentionConsent',
  ];
  expect(methods.map((m) => m.name.getText(f)).sort()).toEqual(expected.sort());
  for (const m of methods) {
    const name = m.name.getText(f);
    if (['command', 'maintain'].includes(name)) continue;
    const required =
      name === 'invite' ? 'new ConnectionStore(this.accounts).send' : 'this.accounts.withSession';
    if (!calls(m, f).includes(required)) throw Error(`Missing ${name} guard`);
  }
  const member = parse('packages/db/src/connections.ts');
  expect(calls(member, member)).toContain('lockedConnection');
  const policy = readFileSync('packages/db/src/connection-policy.ts', 'utf8');
  expect(policy).toContain('isDenied');
  expect(policy).toContain('app.lock_pair');
}
it('I-04 I-10 I-18 M5 architecture classifies every route: private own-history versus guarded explicit invitation, audited staff and bearer deletion receipt', () => {
  const f = parse('apps/web/server/lifecycle-api.ts');
  const labels = nodes(f)
    .filter(ts.isPropertyAssignment)
    .filter((n) => ts.isStringLiteral(n.name) && /^(GET|POST) /.test(n.name.text))
    .map((n) => (n.name as ts.StringLiteral).text);
  expect(labels.sort()).toEqual(
    [
      'GET feedback',
      'POST feedback/:id/present',
      'POST feedback/:id/answer',
      'POST feedback/:id/invite',
      'POST feedback/:id/second-meeting',
      'POST outcomes/exit',
      'GET outcomes/followups',
      'POST outcomes/followups/30',
      'POST outcomes/followups/90',
      'GET outcomes/attention',
      'POST outcomes/attention',
      'GET ops/metrics',
      'POST ops/metrics',
      'GET ops/metrics/readiness',
      'POST ops/metrics/readiness',
    ].sort(),
  );
  const invocation = calls(f, f);
  for (const name of [
    'list',
    'present',
    'answer',
    'invite',
    'secondMeeting',
    'exit',
    'followups',
    'followup',
    'attention',
    'attentionConsent',
  ])
    expect(invocation).toContain(`feedback.${name}`);
  for (const name of ['list', 'freeze', 'readiness', 'review'])
    expect(invocation).toContain(`metrics.${name}`);
  const source = readFileSync('packages/db/src/feedback.ts', 'utf8');
  guards(source);
  expect(() =>
    guards(source.replace('new ConnectionStore(this.accounts).send', 'unguarded')),
  ).toThrow('Missing invite guard');
  expect(() => guards(source.replaceAll('this.accounts.withSession', 'unguarded'))).toThrow(
    'guard',
  );
  const privacy = readFileSync('packages/db/src/lifecycle.ts', 'utf8');
  expect(privacy).toContain('hashToken(token)');
  expect(privacy).toContain('this.accounts.withSession');
});
it('I-04 I-12 I-18 M5 architecture inventories every worker job and keeps lifecycle maintenance out of the member-send path', () => {
  const f = parse('apps/worker/src/lifecycle.ts'),
    jobs = nodes(f)
      .filter(ts.isCallExpression)
      .filter((n) => n.expression.getText(f) === 'boss.work');
  expect(jobs.map((j) => (j.arguments[0] as ts.StringLiteral).text).sort()).toEqual([
    'feedback.maintain',
    'metrics.refresh',
    'privacy.erase',
    'privacy.retain',
  ]);
  for (const j of jobs) expect(calls(j.arguments[1]!, f)).toContain('monitoredJob');
  const source = readFileSync('packages/db/src/lifecycle.ts', 'utf8');
  expect(source).toContain('pg_advisory_xact_lock(55,2)');
  expect(source.indexOf('this.artifacts.remember')).toBeLessThan(
    source.indexOf('ops.erase_primary'),
  );
  for (const path of [
    'packages/db/src/feedback.ts',
    'packages/db/src/metrics.ts',
    'packages/db/src/lifecycle.ts',
  ])
    expect(readFileSync(path, 'utf8')).not.toMatch(/console\.|process\.stdout|logger\./);
  const metrics = parse('packages/db/src/metrics.ts');
  for (const m of nodes(metrics).filter(ts.isMethodDeclaration)) {
    expect(calls(m, metrics)).toContain('this.accounts.withSession');
    expect(calls(m, metrics)).toContain('this.accounts.withStaff');
    expect(m.getText(metrics)).toContain('INSERT INTO ops.audit');
  }
});
