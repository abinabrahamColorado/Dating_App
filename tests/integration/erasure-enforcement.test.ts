import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { connectionFixture } from '../fixtures/connections-db';
import { PrivacyStore } from '../../packages/db/src/lifecycle';
import type { Authority } from '../../packages/db/src/accounts';
import { retention } from '../../packages/config/src/pilot';
import { addCalendarMonths } from '../../packages/core/src/feedback';

const f = connectionFixture(),
  privacy = new PrivacyStore(f.accounts);
beforeAll(() => f.start());
afterAll(() => f.stop());
const months = retention.D9_SAFETY_AFTER_CLOSURE_MONTHS;
const email = (a: Authority) => `${a.memberId}@synthetic.invalid`;
async function restrict(a: Authority, active = true) {
  await f.safety.query(
    'INSERT INTO safety.enforcement(member_id,restricted,version) VALUES($1,$2,1) ON CONFLICT(member_id) DO UPDATE SET restricted=excluded.restricted',
    [a.memberId, active],
  );
}
async function request(a: Authority) {
  return privacy.request(a, randomUUID(), (await f.accounts.policy(a.memberId)).version);
}
async function erase(a: Authority) {
  await f.worker.query('SELECT ops.mark_journaled($1)', [a.memberId]);
  await f.worker.query('SELECT ops.erase_primary($1,$2)', [a.memberId, months]);
}
async function denied(a: Authority) {
  return (
    await f.identity.query('SELECT identity.signup_denied($1) AS denied', [
      f.accounts.lookup(email(a)),
    ])
  ).rows[0].denied;
}

it('I-18 I-19 erasure wins an overlapping signup after owning the privacy lock', async () => {
  const a = await f.member();
  await restrict(a);
  await request(a);
  const db = await f.worker.connect();
  let pending: Promise<string | null> | undefined;
  try {
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(55,2)');
    pending = f.accounts.requestMagicLink(email(a), randomUUID());
    await expect
      .poll(async () =>
        Number(
          (
            await f.admin.query(
              "SELECT count(*) AS n FROM pg_locks WHERE locktype='advisory' AND classid=55 AND objid=2 AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())",
            )
          ).rows[0].n,
        ),
      )
      .toBeGreaterThan(0);
    await db.query('SELECT ops.mark_journaled($1)', [a.memberId]);
    await db.query('SELECT ops.erase_primary($1,$2)', [a.memberId, months]);
    await db.query('COMMIT');
    expect(await pending).toBeNull();
    expect(
      (
        await f.identity.query('SELECT 1 FROM identity.users WHERE email_lookup=$1', [
          f.accounts.lookup(email(a)),
        ])
      ).rowCount,
    ).toBe(0);
  } finally {
    await db.query('ROLLBACK');
    db.release();
    await pending;
  }
});

it('I-12 I-18 DEC-007 enforced deletion retains only the keyed email and D9 expiry; generic auth cannot recreate it', async () => {
  const a = await f.member();
  const browser = randomUUID();
  const link = await f.accounts.requestMagicLink(email(a), browser);
  const row = (
    await f.identity.query('SELECT payload_cipher FROM identity.magic_links WHERE id=$1', [link])
  ).rows[0];
  const payload = f.accounts.identityCipher.open<{ token: string }>(
    row.payload_cipher,
    `magic:${link}`,
  );
  await restrict(a);
  const receipt = await request(a);
  // Check consumption before physical cleanup: no dependence on deleting tokens.
  await expect(f.accounts.consumeMagicLink(payload.token, browser)).rejects.toThrow('INVALID_LINK');
  const stored = (
    await f.safety.query('SELECT * FROM safety.rejoin_denials WHERE email_lookup=$1', [
      f.accounts.lookup(email(a)),
    ])
  ).rows[0];
  expect(Object.keys(stored).sort()).toEqual(['email_lookup', 'expires_at']);
  const job = (
    await f.admin.query('SELECT requested_at FROM ops.deletion_jobs WHERE member_id=$1', [
      a.memberId,
    ])
  ).rows[0];
  expect(stored.expires_at).toEqual(addCalendarMonths(job.requested_at, months));
  await erase(a);
  expect(await f.accounts.requestMagicLink(email(a).toUpperCase(), randomUUID())).toBeNull();
  expect(await denied(a)).toBe(true);
  expect(
    (
      await f.identity.query('SELECT 1 FROM identity.users WHERE email_lookup=$1', [
        stored.email_lookup,
      ])
    ).rowCount,
  ).toBe(0);
  expect(
    (
      await f.identity.query('SELECT 1 FROM identity.magic_links WHERE email_lookup=$1', [
        stored.email_lookup,
      ])
    ).rowCount,
  ).toBe(0);
  await erase(a); // replay/idempotence must not extend the retention clock
  expect(
    (
      await f.safety.query('SELECT expires_at FROM safety.rejoin_denials WHERE email_lookup=$1', [
        stored.email_lookup,
      ])
    ).rows[0].expires_at,
  ).toEqual(stored.expires_at);
  expect(await privacy.receipt(receipt.token)).toMatchObject({ status: 'COMPLETED' });
  expect(JSON.stringify(await privacy.receipt(receipt.token))).not.toMatch(
    /enforcement|denial|email/,
  );
});

it('I-12 I-18 DEC-007 ordinary and lifted-enforcement deletions retain no email denial; rejoining still works', async () => {
  for (const lifted of [false, true]) {
    const a = await f.member();
    if (lifted) {
      await restrict(a);
      await restrict(a, false);
    }
    await request(a);
    await erase(a);
    expect(await denied(a)).toBe(false);
    expect(
      (
        await f.safety.query('SELECT 1 FROM safety.rejoin_denials WHERE email_lookup=$1', [
          f.accounts.lookup(email(a)),
        ])
      ).rowCount,
    ).toBe(0);
    const browser = randomUUID(),
      id = await f.accounts.requestMagicLink(email(a), browser);
    const row = (
      await f.identity.query('SELECT payload_cipher FROM identity.magic_links WHERE id=$1', [id])
    ).rows[0];
    const payload = f.accounts.identityCipher.open<{ token: string }>(
      row.payload_cipher,
      `magic:${id}`,
    );
    const session = await f.accounts.consumeMagicLink(payload.token, browser);
    expect(session.memberId).not.toBe(a.memberId);
  }
});

it('I-12 I-18 D9 expiry releases signup immediately and maintenance physically purges the keyed hash', async () => {
  const a = await f.member();
  await restrict(a);
  await request(a);
  await erase(a);
  const key = f.accounts.lookup(email(a));
  await f.admin.query(
    "UPDATE safety.rejoin_denials SET expires_at=clock_timestamp()-interval '1 second' WHERE email_lookup=$1",
    [key],
  );
  expect(await denied(a)).toBe(false);
  expect(await f.accounts.requestMagicLink(email(a), randomUUID())).not.toBeNull();
  await f.worker.query('SELECT ops.expire_rejoin_denials()');
  expect(
    (await f.safety.query('SELECT 1 FROM safety.rejoin_denials WHERE email_lookup=$1', [key]))
      .rowCount,
  ).toBe(0);
});

it('I-12 safety email hashes are unreadable to identity, app, learning, operator and worker roles; writes cannot bypass denial', async () => {
  const a = await f.member();
  await restrict(a);
  await request(a);
  await erase(a);
  for (const pool of [f.identity, f.app, f.learning, f.ops, f.worker]) {
    await expect(pool.query('SELECT * FROM safety.rejoin_denials')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(pool.query('DELETE FROM safety.rejoin_denials')).rejects.toMatchObject({
      code: '42501',
    });
  }
  const fresh = randomUUID();
  await expect(
    f.identity.query('INSERT INTO identity.users(id,email_lookup,email_cipher) VALUES($1,$2,$3)', [
      fresh,
      f.accounts.lookup(email(a)),
      'synthetic',
    ]),
  ).rejects.toMatchObject({ code: '42501' });
  const ordinary = await f.member();
  await expect(
    f.identity.query('UPDATE identity.users SET email_lookup=$1 WHERE id=$2', [
      f.accounts.lookup(email(a)),
      ordinary.memberId,
    ]),
  ).rejects.toMatchObject({ code: '42501' });
});

it('I-18 D9 a new enforced deletion after expiry starts a finite period even before hourly cleanup', async () => {
  const a = await f.member();
  await restrict(a);
  await request(a);
  await erase(a);
  const key = f.accounts.lookup(email(a));
  await f.admin.query(
    "UPDATE safety.rejoin_denials SET expires_at=clock_timestamp()-interval '1 second' WHERE email_lookup=$1",
    [key],
  );
  const next = await f.member();
  await f.identity.query('UPDATE identity.users SET email_lookup=$1 WHERE id=$2', [
    key,
    next.memberId,
  ]);
  await restrict(next);
  await request(next);
  expect(await denied(a)).toBe(true);
  const job = (
    await f.admin.query('SELECT requested_at FROM ops.deletion_jobs WHERE member_id=$1', [
      next.memberId,
    ])
  ).rows[0];
  expect(
    (
      await f.safety.query('SELECT expires_at FROM safety.rejoin_denials WHERE email_lookup=$1', [
        key,
      ])
    ).rows[0].expires_at,
  ).toEqual(addCalendarMonths(job.requested_at, months));
  await erase(next);
});

it('I-18 I-20 erasure removes only affected moderation receipts and preserves staff audit history without subject linkage', async () => {
  const staff = await f.member(true),
    otherStaff = await f.member(true),
    a = await f.member(),
    b = await f.member();
  const photo = async (member: string) =>
    (await f.app.query('SELECT id FROM app.media WHERE member_id=$1 LIMIT 1', [member])).rows[0]
      .id as string;
  const aPhoto = await photo(a.memberId),
    bPhoto = await photo(b.memberId);
  const receipt = async (actor: string, id: string) => {
    const key = randomUUID();
    await f.ops.query(
      'INSERT INTO ops.moderation_receipts(actor_id,command_key,request_hash,result) VALUES($1,$2,$3,$4)',
      [actor, key, 'synthetic', { id, status: 'APPROVED', version: 1 }],
    );
    return key;
  };
  const affected = await receipt(staff.memberId, aPhoto),
    unrelated = await receipt(otherStaff.memberId, bPhoto),
    own = await receipt(a.memberId, bPhoto);
  await request(a);
  await erase(a);
  expect(
    (
      await f.ops.query(
        'SELECT command_key FROM ops.moderation_receipts WHERE command_key=ANY($1::uuid[])',
        [[affected, unrelated, own]],
      )
    ).rows,
  ).toEqual([{ command_key: unrelated }]);
  const id = randomUUID(),
    caseId = randomUUID();
  await f.ops.query(
    "INSERT INTO ops.audit(id,actor_id,action,subject_id,request_id) VALUES($1,$2,'MEDIA_READ',$3,$4)",
    [id, staff.memberId, bPhoto, randomUUID()],
  );
  await f.safety.query(
    "INSERT INTO safety.case_access_audit(id,actor_id,record_id,action,request_id) VALUES($1,$2,$3,'REPORT_CASE_VIEW',$4)",
    [caseId, staff.memberId, randomUUID(), randomUUID()],
  );
  const original = (await f.ops.query('SELECT * FROM ops.audit WHERE id=$1', [id])).rows[0];
  await request(staff);
  await erase(staff);
  expect((await f.ops.query('SELECT * FROM ops.audit WHERE id=$1', [id])).rows[0]).toEqual({
    ...original,
    subject_id: null,
  });
  expect(
    (await f.safety.query('SELECT actor_id FROM safety.case_access_audit WHERE id=$1', [caseId]))
      .rows,
  ).toEqual([{ actor_id: staff.memberId }]);
  await expect(
    f.ops.query('UPDATE ops.audit SET subject_id=NULL WHERE id=$1', [id]),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    f.admin.query("UPDATE ops.audit SET action='QUEUE_READ' WHERE id=$1", [id]),
  ).rejects.toMatchObject({ code: '42501' });
  expect(
    (
      await f.ops.query('SELECT command_key FROM ops.moderation_receipts WHERE command_key=$1', [
        unrelated,
      ])
    ).rowCount,
  ).toBe(1);
});
