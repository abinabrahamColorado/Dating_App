'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, messageOf, Notice } from './client';
import { SafetyLink, useSafetyCommand } from './safety';
import { Shell } from './shell';
import { exploreConfig } from '@meetwell/config/explore';
import { pilot } from '@meetwell/config/pilot';

type Item = {
  id: string;
  subjectId: string;
  status: string;
  decision: string;
  version: number;
  expiresAt: string | null;
};
type Own = {
  capacity: { held: number; limit: number; version: number; reminders: boolean };
  opportunities: Item[];
};
type Card = Item & {
  profile: {
    displayName: string;
    age: number;
    intention: string;
    interests: string[];
    prompt: string;
    photos: { id: string }[];
  };
};
const labels: Record<string, string> = {
  AWAITING_RESPONSE: 'Ready to consider',
  RESPONSE_SAVED: 'Your response is saved',
  MUTUAL: 'You both accepted',
  EXPIRED: 'Introduction expired',
  YOU_PASSED: 'You passed',
  CLOSED: 'Connection closed',
  UNAVAILABLE: 'Introduction unavailable',
};
export function ExploreHome() {
  const [data, setData] = useState<Own | null>(null),
    [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false);
  const command = useSafetyCommand();
  const refresh = useCallback(async () => {
    try {
      setData(await api<Own>('explore'));
      setError('');
    } catch (e) {
      setError(messageOf(e));
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const active =
    data?.opportunities.filter((o) =>
      ['AWAITING_RESPONSE', 'RESPONSE_SAVED', 'MUTUAL'].includes(o.status),
    ) ?? [];
  return (
    <Shell member>
      <section className="dashboard">
        <p className="eyebrow">AT YOUR PACE</p>
        <h1>A considered introduction.</h1>
        <Notice error={error} status={status} />
        {!data ? (
          <p role="status">Loading your introductions…</p>
        ) : (
          <>
            <p>Your responses stay private. You will only see a connection once you both accept.</p>
            {active.length ? (
              <ul className="intro-list">
                {active.map((o, i) => (
                  <li key={o.id}>
                    <Link href={`/explore/${o.id}`}>
                      Open {o.status === 'MUTUAL' ? 'connection' : 'introduction'} {i + 1}
                    </Link>
                    <span>{labels[o.status]}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="notice">
                No available introduction right now. Next introductions:{' '}
                {exploreConfig.NEXT_BATCH_LABEL}.
              </p>
            )}
            <button className="secondary" onClick={() => void refresh()}>
              Refresh introductions
            </button>
            <form
              className="panel form-stack"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError('');
                const fields = new FormData(e.currentTarget);
                try {
                  await command('explore/capacity', {
                    version: data.capacity.version,
                    limit: Number(fields.get('limit')),
                    reminders: fields.has('reminders'),
                  });
                  setStatus('Your introduction settings are saved.');
                  await refresh();
                } catch (e) {
                  setError(messageOf(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <h2>Space for connection</h2>
              <p>
                {data.capacity.held} of {data.capacity.limit} slots are held by reserved
                introductions or active connections.
              </p>
              {data.capacity.held >= data.capacity.limit && (
                <p className="notice">
                  You are at your current capacity. You can still respond to introductions already
                  reserved for you. Close a connection when you are ready to make space.
                </p>
              )}
              <label htmlFor="limit">Personal connection limit</label>
              <select
                id="limit"
                name="limit"
                key={`limit-${data.capacity.version}`}
                defaultValue={data.capacity.limit}
              >
                {Array.from({ length: pilot.MAX_ACTIVE_CONNECTIONS }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
              </select>
              <p>
                Lowering this limit pauses new reservations; it does not cancel existing
                introductions.
              </p>
              <label className="check">
                <input
                  type="checkbox"
                  name="reminders"
                  key={`reminder-${data.capacity.version}`}
                  defaultChecked={data.capacity.reminders}
                />
                Email me one reminder before an unanswered introduction expires
              </label>
              <button disabled={busy}>Save introduction settings</button>
            </form>
            <section>
              <h2>Past introductions</h2>
              <ul>
                {data.opportunities
                  .filter((o) => !active.includes(o))
                  .map((o) => (
                    <li key={o.id}>
                      {labels[o.status]} · <SafetyLink subjectId={o.subjectId} surface="card" />
                    </li>
                  ))}
              </ul>
              <p>
                Expired introductions are not recorded as passes. Closed connections remain closed.
              </p>
            </section>
          </>
        )}
        <SafetyLink surface="card" />
      </section>
    </Shell>
  );
}
export function Introduction({ id }: { id: string }) {
  const [card, setCard] = useState<Card | null>(null),
    [subject, setSubject] = useState<string>(),
    [status, setStatus] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [closed, setClosed] = useState(false);
  const command = useSafetyCommand();
  const refresh = useCallback(async () => {
    try {
      const result = await api<Card>(`explore/${id}`);
      setCard(result);
      setSubject(result.subjectId);
      setError('');
    } catch (e) {
      setCard(null);
      setError(messageOf(e));
      const own = await api<Own>('explore').catch(() => null);
      setSubject(own?.opportunities.find((o) => o.id === id)?.subjectId);
    }
  }, [id]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function decide(decision: 'ACCEPT' | 'PASS') {
    if (!card) return;
    setBusy(true);
    setError('');
    try {
      const result = await command<{ status: string }>(`explore/${id}/decide`, {
        decision,
        version: card.version,
      });
      setStatus(labels[result.status] ?? 'Your response is saved.');
      if (['RESPONSE_SAVED', 'MUTUAL'].includes(result.status)) await refresh();
      else {
        setCard(null);
        setClosed(true);
      }
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell member>
      <section className="dashboard introduction">
        <Link href="/explore">Back to introductions</Link>
        <p className="eyebrow">ONE INTRODUCTION, AT YOUR PACE</p>
        <h1>{card?.status === 'MUTUAL' ? 'A mutual connection.' : 'Someone to get to know.'}</h1>
        <Notice error={error} status={status} />
        {card && !closed && (
          <article className="panel">
            <div className="photo-grid">
              {card.profile.photos.map((p, i) => (
                <img
                  key={p.id}
                  src={`/api/v1/members/${card.subjectId}/photos/${p.id}`}
                  width={360}
                  height={420}
                  alt={`${card.profile.displayName}, profile photo ${i + 1}`}
                />
              ))}
            </div>
            <h2>
              {card.profile.displayName}, {card.profile.age}
            </h2>
            <p>{card.profile.intention.replaceAll('-', ' ')}</p>
            <div className="tags">
              {card.profile.interests.map((i) => (
                <span key={i}>{i}</span>
              ))}
            </div>
            <p className="eyebrow">A SMALL THING THAT MAKES MY DAY</p>
            <p className="prompt-answer">{card.profile.prompt}</p>
            <p>{labels[card.status]}</p>
            {card.status === 'AWAITING_RESPONSE' && (
              <>
                <p>
                  You have {pilot.EXPLORE_RESPONSE_HOURS} hours from delivery to choose. An
                  unanswered introduction expires without being recorded as a pass. Neither person
                  sees the other’s choice until both accept.
                </p>
                <div className="actions">
                  <button disabled={busy} onClick={() => void decide('ACCEPT')}>
                    Accept introduction
                  </button>
                  <button className="secondary" disabled={busy} onClick={() => void decide('PASS')}>
                    Pass privately
                  </button>
                </div>
              </>
            )}
            {card.status === 'RESPONSE_SAVED' && (
              <p>You can return here later. There is nothing else you need to do.</p>
            )}
            {card.status === 'MUTUAL' && (
              <>
                <p>
                  You both chose to connect. Your profile access stays open while this connection is
                  active.
                </p>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await command(`explore/${id}/close`, {});
                      setClosed(true);
                      setCard(null);
                      setStatus('Connection closed. Your slot is available again.');
                    } catch (e) {
                      setError(messageOf(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Close connection
                </button>
              </>
            )}
            <button className="secondary" disabled={busy} onClick={() => void refresh()}>
              Refresh introduction
            </button>
          </article>
        )}
        <p>
          <SafetyLink {...(subject ? { subjectId: subject } : {})} surface="card" />
        </p>
        <Link href="/safety/help">Get help now</Link>
      </section>
    </Shell>
  );
}
