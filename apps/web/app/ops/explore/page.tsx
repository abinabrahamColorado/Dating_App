'use client';
import { useCallback, useEffect, useState } from 'react';
import { Shell } from '../../../components/shell';
import { api, messageOf, Notice, useMember } from '../../../components/client';
import { useSafetyCommand } from '../../../components/safety';
import { canModerate } from '@meetwell/core/accounts';
type Batch = { id: string; status: string; version: number; created_at: string };
type Review = Batch & {
  policy: string;
  pairs: {
    id: string;
    state: string;
    names: string[] | null;
    lowId: string;
    highId: string;
    eligible: boolean;
  }[];
  unserved: { memberId: string; reason: string }[];
  mail: { state: string; count: number }[];
};
export default function Page() {
  const { me, error: loadError } = useMember();
  const [batches, setBatches] = useState<Batch[]>([]),
    [review, setReview] = useState<Review | null>(null),
    [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false);
  const command = useSafetyCommand(),
    permitted = me ? canModerate(me.roles) : false;
  const refresh = useCallback(async () => {
    try {
      setBatches(await api<Batch[]>('ops/explore'));
    } catch (e) {
      setError(messageOf(e));
    }
  }, []);
  useEffect(() => {
    if (permitted) void refresh();
  }, [permitted, refresh]);
  async function open(id: string) {
    setError('');
    try {
      setReview(await api<Review>(`ops/explore/${id}`));
    } catch (e) {
      setReview(null);
      setError(messageOf(e));
    }
  }
  async function edit(action: 'ADD' | 'REMOVE' | 'APPROVE', fields: Record<string, string> = {}) {
    if (!review) return;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      await command(`ops/explore/${review.id}`, { action, version: review.version, ...fields });
      setStatus(
        action === 'APPROVE'
          ? 'Batch approved. Eligible introductions are queued for delivery.'
          : 'Review updated.',
      );
      await open(review.id);
      await refresh();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell member>
      <section className="dashboard">
        <p className="eyebrow">OPERATIONS · EXPLORE</p>
        <h1>Review introductions.</h1>
        <Notice error={loadError || error} status={status} />
        {!me ? (
          <p role="status">Checking access…</p>
        ) : !permitted ? (
          <p>Assigned operators and administrators can review batches.</p>
        ) : (
          <>
            <p>
              Every review is audited. Approval queues delivery; eligibility is checked again before
              profiles are shared. You cannot curate your own introductions.
            </p>
            <form
              className="panel form-stack"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError('');
                const f = new FormData(e.currentTarget);
                const scope = String(f.get('members') ?? '').trim();
                try {
                  const r = await command<{ id: string }>('ops/explore', {
                    seed: crypto.randomUUID(),
                    ...(scope ? { members: scope.split(/[\s,]+/).filter(Boolean) } : {}),
                  });
                  await refresh();
                  await open(r.id);
                  setStatus('Batch prepared for review.');
                } catch (e) {
                  setError(messageOf(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <h2>Prepare a batch</h2>
              <label htmlFor="members">Optional member IDs for a concierge cohort</label>
              <textarea id="members" name="members" rows={2} />
              <p>
                Leave blank for the full pilot allocator. An explicit cohort is recorded as an
                operator policy with unknown propensity. Separate IDs with spaces or commas.
              </p>
              <button disabled={busy}>Prepare review batch</button>
            </form>
            <button className="secondary" onClick={() => void refresh()}>
              Refresh batches
            </button>
            <ul>
              {batches.map((b) => (
                <li key={b.id}>
                  <button className="secondary" onClick={() => void open(b.id)}>
                    Review {b.id}
                  </button>{' '}
                  {b.status.toLowerCase()}
                </li>
              ))}
            </ul>
            {review && (
              <section className="panel">
                <h2>Batch review</h2>
                <p>
                  Policy: {review.policy === 'operator' ? 'Operator curated' : 'Pilot allocator'} ·{' '}
                  {review.status.toLowerCase()}
                </p>
                {review.pairs.map((p) => (
                  <article className="review-pair" key={p.id}>
                    <h3>{p.names?.join(' and ') ?? 'Pair currently unavailable'}</h3>
                    <p>
                      Member IDs: {p.lowId} · {p.highId}
                    </p>
                    <p>
                      {p.state.toLowerCase()} ·{' '}
                      {p.eligible
                        ? 'Current eligibility checks pass'
                        : 'Current eligibility checks do not pass'}
                    </p>
                    {review.status === 'REVIEW' && p.state === 'RESERVED' && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => void edit('REMOVE', { opportunityId: p.id })}
                      >
                        Remove pair
                      </button>
                    )}
                  </article>
                ))}
                <h3>Unserved at generation</h3>
                <p>
                  This records the original allocation snapshot. Operator edits below do not rewrite
                  that history. Reasons describe supply and capacity, never desirability.
                </p>
                <ul>
                  {review.unserved.map((u) => (
                    <li key={u.memberId}>
                      {u.memberId}: {u.reason}
                    </li>
                  ))}
                </ul>
                {review.status === 'REVIEW' && (
                  <>
                    <form
                      className="form-stack"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void edit('ADD', { u: String(f.get('u')), v: String(f.get('v')) });
                      }}
                    >
                      <h3>Add a concierge introduction</h3>
                      <p>
                        The same bilateral boundaries, block checks, permanent pair history, travel
                        feasibility and capacity apply.
                      </p>
                      <label htmlFor="u">First member ID</label>
                      <input id="u" name="u" required />
                      <label htmlFor="v">Second member ID</label>
                      <input id="v" name="v" required />
                      <button className="secondary" disabled={busy}>
                        Add eligible pair
                      </button>
                    </form>
                    <p>Any edit marks the entire batch as operator curated.</p>
                    <button disabled={busy} onClick={() => void edit('APPROVE')}>
                      Approve batch for delivery
                    </button>
                  </>
                )}
                <h3>Notification review</h3>
                {review.mail.length ? (
                  <ul>
                    {review.mail.map((m) => (
                      <li key={m.state}>
                        {m.state.toLowerCase()}: {m.count}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No failed or uncertain notifications in this batch.</p>
                )}
                <p>
                  Uncertain sends require mailbox/provider verification. They are never
                  automatically resent.
                </p>
              </section>
            )}
          </>
        )}
      </section>
    </Shell>
  );
}
