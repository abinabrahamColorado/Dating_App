import type { Page } from '@playwright/test';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { AccountStore, type Authority } from '../../packages/db/src/accounts';
import { ExploreStore } from '../../packages/db/src/explore';
import { ConnectionStore } from '../../packages/db/src/connections';
import { FeedbackStore } from '../../packages/db/src/feedback';
import { VenueStore } from '../../packages/db/src/venues';
import { hashToken } from '../../packages/db/src/encryption';
import { accountConfig } from '../../packages/config/src/accounts';
import { syntheticProfile, syntheticPreferences } from './accounts';
import { syntheticVenue } from './venues';
import { localMeetingInstant, zonedParts } from '../../packages/core/src/connections';
export function lifecycleBrowser() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith('_test')) throw Error('Real test database required');
  const admin = new Pool({ connectionString: url }),
    identity = new Pool({ connectionString: process.env.TEST_IDENTITY_DATABASE_URL! }),
    app = new Pool({ connectionString: process.env.TEST_APP_DATABASE_URL! }),
    ops = new Pool({ connectionString: process.env.TEST_OPS_DATABASE_URL! });
  const accounts = new AccountStore({
    app,
    identity,
    ops,
    identityKey: process.env.IDENTITY_ENCRYPTION_KEY!,
    appKey: process.env.APP_ENCRYPTION_KEY!,
    lookupKey: process.env.LOOKUP_KEY!,
  });
  const explore = new ExploreStore(accounts),
    connections = new ConnectionStore(accounts),
    venues = new VenueStore(accounts),
    feedback = new FeedbackStore(accounts),
    ids: string[] = [],
    venueIds: string[] = [];
  async function member(page: Page, staff = false): Promise<Authority> {
    const id = randomUUID(),
      sessionId = randomUUID(),
      token = randomUUID();
    ids.push(id);
    await identity.query(
      'INSERT INTO identity.users(id,email_lookup,email_cipher) VALUES($1,$2,$3)',
      [
        id,
        accounts.lookup(`${id}@synthetic.invalid`),
        accounts.identityCipher.seal(`${id}@synthetic.invalid`, `email:${id}`),
      ],
    );
    await identity.query(
      "INSERT INTO identity.sessions(id,member_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 day')",
      [sessionId, id, hashToken(token)],
    );
    await accounts.ensureMember(id);
    await accounts.register(id, {
      birthDate: '2002-01-15',
      termsVersion: accountConfig.TERMS_VERSION,
      privacyVersion: accountConfig.PRIVACY_VERSION,
      accepted: true,
    });
    await accounts.saveProfile(id, randomUUID(), 0, syntheticProfile);
    await accounts.savePreferences(id, randomUUID(), 0, syntheticPreferences);
    if (!staff)
      for (let i = 0; i < 2; i++)
        await admin.query("INSERT INTO app.media(id,member_id,status) VALUES($1,$2,'APPROVED')", [
          randomUUID(),
          id,
        ]);
    await admin.query("UPDATE app.members SET state='ACTIVE' WHERE id=$1", [id]);
    if (staff)
      await admin.query(
        "INSERT INTO ops.staff(member_id,role) VALUES($1,'operator'),($1,'safety_reviewer')",
        [id],
      );
    await page.context().addCookies([
      {
        name: 'meetwell_session',
        value: token,
        url: 'http://localhost:3100',
        httpOnly: true,
        sameSite: 'Strict',
      },
    ]);
    return { memberId: id, sessionId, authenticatedAt: new Date(), registered: true, age: 24 };
  }
  async function encounter(a: Authority, b: Authority, staff: Authority) {
    const venue = syntheticVenue();
    venueIds.push(venue.id);
    await venues.save(staff, randomUUID(), venue, randomUUID());
    const batch = await explore.generate(
        staff,
        randomUUID(),
        { seed: randomUUID(), members: [a.memberId, b.memberId] },
        randomUUID(),
      ),
      review = await explore.review(staff, batch.id, randomUUID()),
      connection = review.pairs[0]!.id;
    await explore.edit(
      staff,
      batch.id,
      randomUUID(),
      { action: 'APPROVE', version: 0 },
      randomUUID(),
    );
    await explore.deliverOne(connection);
    for (const auth of [a, b])
      await explore.decide(auth, connection, randomUUID(), { decision: 'ACCEPT', version: 0 });
    const parts = zonedParts(new Date(), 'America/New_York'),
      date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1))
        .toISOString()
        .slice(0, 10);
    const options = await connections.options(a, connection, randomUUID(), {
      start: localMeetingInstant(`${date}T11:00`)!,
      minutes: 30,
    });
    const plan = await connections.plan(a, connection, randomUUID(), {
      action: 'PROPOSE',
      optionsId: options.id,
      venueId: venue.id,
    });
    for (const auth of [a, b])
      await connections.plan(auth, connection, randomUUID(), {
        action: 'CONFIRM',
        planId: plan.id,
        revision: 1,
      });
    const id = (
      await admin.query<{ id: string }>(
        "UPDATE app.encounters SET start_at=clock_timestamp()-interval '2 days' WHERE plan_id=$1 RETURNING id",
        [plan.id],
      )
    ).rows[0]!.id;
    await feedback.maintain();
    return { id, connection };
  }
  async function close() {
    await admin.query("UPDATE app.members SET state='PAUSED' WHERE id=ANY($1::uuid[])", [ids]);
    await admin.query('UPDATE app.explore_venues SET approved=false WHERE id=ANY($1::uuid[])', [
      venueIds,
    ]);
    await Promise.all([admin, identity, app, ops].map((p) => p.end()));
  }
  return { admin, accounts, feedback, member, encounter, close };
}
