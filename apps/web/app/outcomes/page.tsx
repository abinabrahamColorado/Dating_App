'use client';
import { useEffect, useState } from 'react';
import { Shell } from '../../components/shell';
import { api, Notice, messageOf } from '../../components/client';
import { useSafetyCommand, SafetyLink } from '../../components/safety';
type Followup = {
  day: number;
  dueAt: string;
  revoked: boolean;
  presented: boolean;
  answer: string;
};
function FollowupCard({ value, refresh }: { value: Followup; refresh: () => Promise<void> }) {
  const command = useSafetyCommand(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [show, setShow] = useState(!value.presented);
  const due = Date.parse(value.dueAt) <= Date.now();
  useEffect(() => {
    if (due && !value.presented && !value.revoked && value.answer === 'UNKNOWN')
      void command(`outcomes/followups/${value.day}`, { action: 'PRESENT' }).catch((e) =>
        setError(messageOf(e)),
      );
  }, [due, value, command]);
  async function run(data: unknown) {
    setBusy(true);
    try {
      await command(`outcomes/followups/${value.day}`, data);
      await refresh();
      setShow(false);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="panel form-stack">
      <h2>{value.day}-day follow-up</h2>
      <Notice error={error} />
      {value.revoked ? (
        <p>You withdrew this follow-up consent.</p>
      ) : (
        <>
          <p>
            {due ? 'Available now.' : `Available on ${new Date(value.dueAt).toLocaleDateString()}.`}
          </p>
          {value.answer !== 'UNKNOWN' ? (
            <p>Your answer is saved privately.</p>
          ) : due && show ? (
            <>
              <p>Is the meaningful connection you told us about continuing?</p>
              <div className="actions">
                {(
                  [
                    ['CONTINUING', 'Yes'],
                    ['ENDED', 'No'],
                    ['PREFER_NOT_TO_SAY', 'Prefer not to say'],
                  ] as const
                ).map(([answer, label]) => (
                  <button
                    className="secondary"
                    key={answer}
                    disabled={busy}
                    onClick={() => void run({ action: 'ANSWER', answer })}
                  >
                    {label}
                  </button>
                ))}
                <button className="secondary" onClick={() => setShow(false)}>
                  Skip
                </button>
              </div>
            </>
          ) : (
            <p>No answer recorded. This stays unknown.</p>
          )}
          {due && !show && value.answer === 'UNKNOWN' && (
            <button className="secondary" onClick={() => setShow(true)}>
              Choose to answer
            </button>
          )}
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void run({ action: 'REVOKE' })}
          >
            Withdraw this follow-up consent
          </button>
        </>
      )}
    </article>
  );
}
export default function Page() {
  const [rows, setRows] = useState<Followup[]>([]),
    [error, setError] = useState(''),
    [enabled, setEnabled] = useState(false),
    [status, setStatus] = useState('');
  async function refresh() {
    setRows(await api<Followup[]>('outcomes/followups'));
  }
  useEffect(() => {
    void Promise.all([
      api<Followup[]>('outcomes/followups'),
      api<{ enabled: boolean }>('outcomes/attention'),
    ])
      .then(([r, a]) => {
        setRows(r);
        setEnabled(a.enabled);
      })
      .catch((e) => setError(messageOf(e)));
  }, []);
  return (
    <Shell member>
      <section className="dashboard form-stack">
        <h1>Follow-up choices</h1>
        <p>
          Each follow-up is optional and separately consented. Missing an answer stays unknown. It
          never means a relationship ended.
        </p>
        <Notice error={error} status={status} />
        {!rows.length && <p>You have no consented follow-ups.</p>}
        {rows.map((r) => (
          <FollowupCard key={r.day} value={r} refresh={refresh} />
        ))}
        <section className="panel form-stack">
          <h2>Help us measure time spent (optional)</h2>
          <p>
            Share a count of active seconds while using the member app. We do not record screen
            content, keystrokes, messages or location. You can stop at any time.
          </p>
          <label className="check-row">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => {
                const value = e.target.checked;
                void api('outcomes/attention', { action: 'CONSENT', enabled: value })
                  .then(() => {
                    setEnabled(value);
                    setStatus(
                      'Your measurement choice is saved. It takes effect on your next page visit.',
                    );
                  })
                  .catch((x) => setError(messageOf(x)));
              }}
            />
            Share active-time counts
          </label>
        </section>
        <SafetyLink surface="settings" />
      </section>
    </Shell>
  );
}
