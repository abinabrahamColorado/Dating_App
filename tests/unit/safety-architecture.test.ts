import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { expect, it } from 'vitest';

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
  );
}
function parse(path: string, text = readFileSync(path, 'utf8')) {
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
}
function nodes(root: ts.Node): ts.Node[] {
  const out: ts.Node[] = [];
  function visit(n: ts.Node) {
    out.push(n);
    ts.forEachChild(n, visit);
  }
  visit(root);
  return out;
}
function calls(root: ts.Node) {
  return nodes(root).filter(ts.isCallExpression);
}
function fn(file: ts.SourceFile, name: string) {
  const n = nodes(file).find((n) => ts.isFunctionDeclaration(n) && n.name?.text === name);
  if (!n || !ts.isFunctionDeclaration(n)) throw Error(`Missing ${name}`);
  return n;
}
function requiresPairGuard(source: string) {
  const file = parse('fixture.ts', source);
  for (const name of ['memberProfile', 'memberPhoto']) {
    const body = fn(file, name).body;
    if (!body || body.statements.length !== 1)
      throw Error('Member data must return only the guarded callback');
    const statement = body.statements[0]!;
    if (
      !ts.isReturnStatement(statement) ||
      !statement.expression ||
      !ts.isCallExpression(statement.expression) ||
      statement.expression.expression.getText(file) !== 'withMemberPair'
    )
      throw Error('Missing pair guard');
  }
}

it('I-04 architecture: every HTTP entry and worker is inventoried; new surfaces fail closed pending policy classification', () => {
  // Reviewed non-member routes/jobs are sealed against silently adding a member
  // disclosure under an old name. Review any diff before updating these baselines;
  // a new member-data path must use withMemberPair and get a negative race test.
  const reviewedSelfAndInfrastructure: Record<string, string> = {
    'apps/web/server/api.ts': 'd7a41e7d84a71704dd12126f1237acbe61de6d10532362921f521b7fc2881696',
    'apps/web/server/passkeys.ts':
      'b4f7600984751171bf430f0d4afe7760d26ba284fce4f5f90ccb3c1d151caa64',
    'apps/web/server/mail.ts': '3412a014fd66e8790e27bdcd0dbf348dd564d46b7d20da2c0120e7ed2d918f2a',
    'apps/worker/src/main.ts': 'd771388492cbf4a428cfd76ec5ef9094fbe5870119fac3f4e33c563e1240b30a',
    'apps/worker/src/worker.ts': '4ca1ef0251aed6b867a0d1c13fda3a4d62bb9e90ea22bf95c99742079daa2cf7',
  };
  for (const [path, hash] of Object.entries(reviewedSelfAndInfrastructure))
    expect(
      createHash('sha256')
        .update(readFileSync(path, 'utf8').replaceAll('\r\n', '\n'))
        .digest('hex'),
      `${path}: re-review the data classification; never blindly refresh this hash`,
    ).toBe(hash);
  expect(files('apps/web/app/api').sort()).toEqual([
    'apps/web/app/api/v1/[...path]/route.ts',
    'apps/web/app/api/v1/health/route.ts',
  ]);
  expect(files('apps/web/server').sort()).toEqual(
    [
      'api.ts',
      'mail.ts',
      'media.ts',
      'passkeys.ts',
      'runtime.ts',
      'safety-api.ts',
      'safety-runtime.ts',
      'setup-storage.ts',
    ]
      .map((f) => `apps/web/server/${f}`)
      .sort(),
  );
  expect(files('apps/worker/src').sort()).toEqual([
    'apps/worker/src/main.ts',
    'apps/worker/src/worker.ts',
  ]);
  const jobs = files('apps/worker/src')
    .flatMap((p) => {
      const f = parse(p);
      return calls(f)
        .filter(
          (n) => ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'work',
        )
        .map((n) => n.arguments[0]?.getText(f));
    })
    .sort();
  expect(jobs).toEqual(["'auth.deliver'", 'HEALTH_QUEUE']); // Both deliver infrastructure/auth data only, never another member's data.
  const entry = parse('apps/web/app/api/v1/[...path]/route.ts');
  expect(calls(entry).filter((c) => c.expression.getText(entry) === 'handle')).toHaveLength(2);
});
it('I-04 architecture: every current member-data route calls the guarded store; bypass mutation fails this test', () => {
  const source = readFileSync('packages/db/src/member-access.ts', 'utf8');
  requiresPairGuard(source);
  expect(() =>
    requiresPairGuard(
      source.replace(
        'return withMemberPair(store, auth, subject, async (db) => {',
        'return unguarded(store, auth, subject, async (db) => {',
      ),
    ),
  ).toThrow('Missing pair guard');
  const f = parse('packages/db/src/member-access.ts');
  const guard = fn(f, 'withMemberPair');
  expect(calls(guard).some((c) => c.expression.getText(f) === 'isDenied')).toBe(true);
  expect(calls(guard).some((c) => c.arguments[0]?.getText(f).includes('app.lock_pair'))).toBe(true);
  const handler = parse('apps/web/server/safety-api.ts');
  const memberRoutes = nodes(handler)
    .filter(ts.isIfStatement)
    .filter((n) => n.expression.getText(handler).startsWith("route === 'GET members/"));
  expect(memberRoutes).toHaveLength(2);
  for (const [index, route] of memberRoutes.entries()) {
    const stmt = route.thenStatement;
    expect(ts.isReturnStatement(stmt)).toBe(true);
    if (!ts.isReturnStatement(stmt) || !stmt.expression || !ts.isCallExpression(stmt.expression))
      throw Error('Unguarded member route');
    expect(stmt.expression.expression.getText(handler)).toBe(
      index === 0 ? 'memberProfile' : 'memberPhoto',
    );
  }
  // Declaring a new member route requires a guarded handler, not just a manifest label.
  const labels = nodes(handler)
    .filter(ts.isPropertyAssignment)
    .filter((n) => ts.isStringLiteral(n.name) && n.name.text.includes(' members/'));
  expect(labels).toHaveLength(memberRoutes.length);
  expect(source.match(/\bisDenied\(/g)).toHaveLength(1);
});
it('I-04 I-12 architecture: existing account routes remain self-scoped; no new database/read/send bypass outside reviewed boundaries', () => {
  const f = parse('apps/web/server/api.ts');
  const methods = [
    ...new Set(
      calls(f)
        .filter(
          (n) =>
            ts.isPropertyAccessExpression(n.expression) &&
            n.expression.expression.getText(f) === 'db',
        )
        .map((n) => (n.expression as ts.PropertyAccessExpression).name.text),
    ),
  ].sort();
  expect(methods).toEqual(
    [
      'addPhoto',
      'auditLog',
      'changePolicy',
      'consumeMagicLink',
      'lookup',
      'moderate',
      'moderationQueue',
      'photoAccess',
      'photos',
      'policy',
      'preferenceHistory',
      'profile',
      'rateLimit',
      'register',
      'removePhoto',
      'requestMagicLink',
      'revokeSessions',
      'savePreferences',
      'saveProfile',
      'sessions',
      'staffRoles',
      'withSession',
    ].sort(),
  );
  for (const c of calls(f))
    if (
      ts.isPropertyAccessExpression(c.expression) &&
      ['profile', 'preferenceHistory', 'photos'].includes(c.expression.name.text)
    )
      expect(c.arguments[0]?.getText(f)).toBe('auth.memberId');
  const routes = nodes(f)
    .filter(ts.isBinaryExpression)
    .filter((n) => n.left.getText(f) === 'route' && ts.isStringLiteral(n.right))
    .map((n) => (n.right as ts.StringLiteral).text)
    .sort();
  expect(routes).toEqual(
    [
      'auth/request',
      'auth/consume',
      'auth/passkey/options',
      'auth/passkey/verify',
      'me',
      'account/register',
      'auth/signout',
      'account/sessions',
      'account/sessions/revoke-others',
      'account/policy',
      'profile',
      'preferences',
      'photos',
      'ops/photos',
      'ops/audit',
    ].sort(),
  );
  for (const p of [
    ...files('apps/web/app'),
    ...files('apps/web/components'),
    ...files('apps/worker/src'),
  ].filter((p) => /\.tsx?$/.test(p))) {
    const text = readFileSync(p, 'utf8');
    for (const n of nodes(parse(p, text))
      .filter(ts.isImportDeclaration)
      .filter((n) => !n.importClause?.isTypeOnly))
      expect(
        n.moduleSpecifier.getText(),
        `${p}: no raw database or narrative store in pages/workers`,
      ).not.toMatch(/['"](?:pg|@meetwell\/db\/(?:member-access|safety))['"]/);
  }
  // Only the reviewed HTTP dispatcher imports serving disclosure methods.
  const importers = files('apps/web/server').filter((p) =>
    readFileSync(p, 'utf8').includes('@meetwell/db/member-access'),
  );
  expect(importers).toEqual(['apps/web/server/safety-api.ts']);
  for (const p of files('apps/web/server'))
    if (!['apps/web/server/passkeys.ts'].includes(p))
      expect(readFileSync(p, 'utf8')).not.toContain('.query(');
});
