'use client';
import { useCallback, useEffect, useState } from 'react';
import { Shell } from '../../../../components/shell';
import { api, Notice, messageOf } from '../../../../components/client';
import { useSafetyCommand } from '../../../../components/safety';
type Case = {
  id: string;
  kind: string;
  closed_at: string | null;
  hold_version: number;
  until_at: string | null;
  review_at: string | null;
  reason: string | null;
  released_at: string | null;
};
export default function Page() {
  const [rows, setRows] = useState<Case[]>([]),
    [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false);
  const command = useSafetyCommand(),
    refresh = useCallback(async () => {
      try {
        setRows(await api<Case[]>('ops/safety/retention'));
      } catch (e) {
        setError(messageOf(e));
      }
    }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function submit(data: unknown) {
    setBusy(true);
    try {
      await command('ops/safety/retention', data);
      setStatus('Retention decision recorded and audited.');
      await refresh();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell member>
      <section className="dashboard form-stack">
        <h1>Safety retention review</h1>
        <p>
          Closed cases expire after 24 calendar months unless a documented, case-specific hold
          applies. Review holds at least annually. Do not place a generic or indefinite hold.
        </p>
        <Notice error={error} status={status} />
        {!rows.length && <p>No cases appear in the annual-review or active-hold queue.</p>}
        {rows.map((r) => (
          <article className="panel form-stack" key={`${r.kind}:${r.id}`}>
            <h2>
              {r.kind} · {r.id}
            </h2>
            <p>
              {r.closed_at ? `Closed ${new Date(r.closed_at).toLocaleDateString()}` : 'Open case'}
            </p>
            {r.until_at && !r.released_at && (
              <p>
                Hold until {new Date(r.until_at).toLocaleDateString()}; review by{' '}
                {new Date(r.review_at!).toLocaleDateString()}. Justification: {r.reason}
              </p>
            )}
            <button
              disabled={busy}
              className="secondary"
              onClick={() =>
                void submit({
                  action: 'REVIEW',
                  kind: r.kind,
                  recordId: r.id,
                  version: r.hold_version,
                })
              }
            >
              Record annual review
            </button>
            {r.until_at && !r.released_at && (
              <button
                disabled={busy}
                className="secondary"
                onClick={() =>
                  void submit({
                    action: 'RELEASE',
                    kind: r.kind,
                    recordId: r.id,
                    version: r.hold_version,
                  })
                }
              >
                Release this hold
              </button>
            )}
          </article>
        ))}
        <form
          className="panel form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void submit({
              action: 'SET',
              kind: f.get('kind'),
              recordId: f.get('recordId'),
              version: Number(f.get('version')),
              reason: f.get('reason'),
              until: new Date(`${String(f.get('until'))}T00:00:00Z`).toISOString(),
              review: new Date(`${String(f.get('review'))}T00:00:00Z`).toISOString(),
            });
          }}
        >
          <h2>Place or renew a case-specific hold</h2>
          <label>
            Case type
            <select name="kind">
              <option value="report">Safety report</option>
              <option value="integrity">Integrity review</option>
              <option value="appeal">Appeal</option>
            </select>
          </label>
          <label>
            Case identifier
            <input name="recordId" required />
          </label>
          <label>
            Current hold version (0 for no hold)
            <input name="version" type="number" min="0" defaultValue="0" required />
          </label>
          <label>
            Documented legal justification
            <textarea name="reason" required maxLength={2000} />
          </label>
          <label>
            Hold ends (UTC)
            <input type="date" name="until" required />
          </label>
          <label>
            Next review (UTC, within one year)
            <input type="date" name="review" required />
          </label>
          <button disabled={busy}>Record hold</button>
        </form>
      </section>
    </Shell>
  );
}
