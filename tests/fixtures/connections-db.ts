import { Pool } from 'pg';
import { randomUUID, randomBytes } from 'node:crypto';
import { migrate } from '../../packages/db/src/migrate';
import { AccountStore, type Authority } from '../../packages/db/src/accounts';
import { ExploreStore } from '../../packages/db/src/explore';
import { ConnectionStore } from '../../packages/db/src/connections';
import { VenueStore } from '../../packages/db/src/venues';
import { SafetyStore } from '../../packages/db/src/safety';
import { hashToken } from '../../packages/db/src/encryption';
import { accountConfig } from '../../packages/config/src/accounts';
import { syntheticProfile, syntheticPreferences } from './accounts';
import { syntheticVenue } from './venues';
import { localMeetingInstant, zonedParts } from '../../packages/core/src/connections';
export function connectionFixture() {
  const source = process.env.TEST_DATABASE_URL;
  if (!source || !new URL(source).pathname.endsWith('_test'))
    throw Error('Real isolated PostgreSQL required');
  const name = `meetwell_connections_${randomUUID().replaceAll('-', '')}_test`,
    cluster = new Pool({ connectionString: source }),
    url = new URL(source);
  url.pathname = `/${name}`;
  const admin = new Pool({ connectionString: url.toString() }),
    role = (name: string) => {
      const u = new URL(url);
      u.searchParams.set('options', `-c role=meetwell_${name}`);
      return new Pool({
        connectionString: u.toString(),
        application_name: `connections-test-${name}`,
      });
    };
  const app = role('app'),
    identity = role('identity'),
    ops = role('ops'),
    safety = role('safety'),
    learning = role('learning'),
    key = () => randomBytes(32).toString('base64');
  const accounts = new AccountStore({
      app,
      identity,
      ops,
      identityKey: key(),
      appKey: key(),
      lookupKey: key(),
    }),
    explore = new ExploreStore(accounts),
    connections = new ConnectionStore(accounts),
    venues = new VenueStore(accounts),
    safetyStore = new SafetyStore(accounts, safety, key());
  async function start() {
    if (!/^meetwell_connections_[a-f0-9]{32}_test$/.test(name)) throw Error('Invalid fixture');
    await cluster.query(`CREATE DATABASE "${name}"`);
    await migrate(url.toString());
  }
  async function stop() {
    await Promise.all([admin, app, identity, ops, safety, learning].map((p) => p.end()));
    await cluster.query(`DROP DATABASE "${name}"`);
    await cluster.end();
  }
  async function member(staff = false): Promise<Authority> {
    const id = randomUUID(),
      sessionId = randomUUID();
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
      [sessionId, id, hashToken(randomUUID())],
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
    return { memberId: id, sessionId, authenticatedAt: new Date(), registered: true, age: 24 };
  }
  async function pair() {
    const staff = await member(true),
      a = await member(),
      b = await member(),
      venue = syntheticVenue();
    await venues.save(staff, randomUUID(), venue, randomUUID());
    const batch = await explore.generate(
        staff,
        randomUUID(),
        { seed: randomUUID(), members: [a.memberId, b.memberId] },
        randomUUID(),
      ),
      review = await explore.review(staff, batch.id, randomUUID()),
      id = review.pairs[0]!.id;
    await explore.edit(
      staff,
      batch.id,
      randomUUID(),
      { action: 'APPROVE', version: 0 },
      randomUUID(),
    );
    await explore.deliverOne(id);
    await explore.decide(a, id, randomUUID(), { decision: 'ACCEPT', version: 0 });
    await explore.decide(b, id, randomUUID(), { decision: 'ACCEPT', version: 0 });
    return { a, b, staff, id, venue: { ...venue, version: 1 } };
  }
  function time() {
    const d = zonedParts(new Date(), 'America/New_York'),
      date = new Date(Date.UTC(d.year, d.month - 1, d.day + 1)).toISOString().slice(0, 10);
    return { start: localMeetingInstant(`${date}T11:00`)!, minutes: 30 };
  }
  async function proposed(p: Awaited<ReturnType<typeof pair>>, t = time()) {
    const options = await connections.options(p.a, p.id, randomUUID(), t);
    return connections.plan(p.a, p.id, randomUUID(), {
      action: 'PROPOSE',
      optionsId: options.id,
      venueId: p.venue.id,
    });
  }
  return {
    url: url.toString(),
    admin,
    app,
    identity,
    ops,
    safety,
    learning,
    accounts,
    explore,
    connections,
    venues,
    safetyStore,
    start,
    stop,
    member,
    pair,
    time,
    proposed,
  };
}
