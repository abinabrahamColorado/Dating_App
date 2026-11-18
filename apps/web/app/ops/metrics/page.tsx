'use client';
import { useCallback, useEffect, useState } from 'react';
import type { publicMetrics, Completeness } from '@meetwell/core/metrics';
import { Shell } from '../../../components/shell';
import { api, Notice, messageOf, useMember } from '../../../components/client';
import { useSafetyCommand } from '../../../components/safety';
type Snapshot = ReturnType<typeof publicMetrics> & { operations: Record<string, unknown> | null };
type Row = {
  id: string;
  started_at: string;
  policy_version: string;
  updated_at: string | null;
  body: Snapshot | null;
};
function ReadinessEditor() {
  const [reviews, setReviews] = useState<
      { gate: string; version: number; passed: boolean; evidence: string; expires_at: string }[]
    >([]),
    [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false);
  const command = useSafetyCommand();
  const refresh = useCallback(async () => {
    setReviews(await api<typeof reviews>('ops/metrics/readiness'));
  }, []);
  useEffect(() => {
    void refresh().catch((e) => setError(messageOf(e)));
  }, [refresh]);
  async function save(form: HTMLFormElement) {
    const data = new FormData(form),
      gate = String(data.get('gate'));
    setBusy(true);
    try {
      await command('ops/metrics/readiness', {
        gate,
        version: reviews.find((r) => r.gate === gate)?.version ?? 0,
        passed: data.get('passed') === 'on',
        evidence: data.get('evidence'),
      });
      await refresh();
      setStatus(
        'Review recorded. A passing review expires after 30 days and does not authorize a launch.',
      );
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details>
      <summary>Record readiness evidence (administrator)</summary>
      <Notice error={error} status={status} />
      <p>
        Use reviewed evidence, including the named incident owner and staffed windows for
        operations. Keep member data out of this record. This does not change enrollment or Go
        flags.
      </p>
      {reviews.map((r) => (
        <p key={r.gate}>
          {r.gate}: {r.passed ? 'Pass' : 'Fail'} until {new Date(r.expires_at).toLocaleDateString()}
          . Evidence: {r.evidence}
        </p>
      ))}
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save(e.currentTarget);
        }}
      >
        <label>
          Gate
          <select name="gate">
            <option value="CONSENT_PRIVACY">Consent and privacy</option>
            <option value="OPERATIONS">Operational readiness</option>
            <option value="EXPERIENCE">Experience review</option>
          </select>
        </label>
        <label>
          Evidence and review record
          <textarea name="evidence" required maxLength={2000} />
        </label>
        <label className="check-row">
          <input type="checkbox" name="passed" />
          The required evidence has been reviewed and this gate passes
        </label>
        <button disabled={busy}>Save reviewed evidence</button>
      </form>
    </details>
  );
}
function Complete({ value }: { value: Completeness }) {
  return (
    <p>
      Completeness: both observed {value.both}; one {value.one}; neither {value.neither};
      contradictory {value.contradictory}.
    </p>
  );
}
function Count({
  title,
  value,
}: {
  title: string;
  value: { numerator: number; denominator: number; completeness: Completeness } | null;
}) {
  return (
    <article className="panel">
      <h3>{title}</h3>
      {value ? (
        <>
          <p>
            {value.numerator} / {value.denominator}
          </p>
          <Complete value={value.completeness} />
        </>
      ) : (
        <p>Suppressed: insufficient group size or a small component.</p>
      )}
    </article>
  );
}
export default function Page() {
  const { me, error: memberError } = useMember(),
    [rows, setRows] = useState<Row[]>([]),
    [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false);
  const command = useSafetyCommand(),
    permitted = !!me?.roles.some((x) => x === 'operator' || x === 'admin');
  const refresh = useCallback(async () => {
    try {
      setRows(await api<Row[]>('ops/metrics'));
    } catch (e) {
      setError(messageOf(e));
    }
  }, []);
  useEffect(() => {
    if (permitted) void refresh();
  }, [permitted, refresh]);
  async function freeze() {
    setBusy(true);
    try {
      await command('ops/metrics', { action: 'FREEZE' });
      setStatus('Enrollment is fixed. The worker will prepare a privacy-filtered snapshot.');
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
        <p className="eyebrow">OPERATIONS</p>
        <h1>Outcomes & readiness</h1>
        <Notice error={memberError || error} status={status} />
        {!permitted ? (
          <p>Assigned operators and administrators can review these aggregates.</p>
        ) : (
          <>
            {me?.roles.includes('admin') && <ReadinessEditor />}
            <p>
              Freeze an enrollment cohort before observing outcomes. Only active discovery-seeking
              members who have never joined another cohort are enrolled. Leaving or deleting never
              shrinks its denominator.
            </p>
            <div className="actions">
              <button disabled={busy} onClick={() => void freeze()}>
                Freeze new enrollment cohort
              </button>
              <button className="secondary" onClick={() => void refresh()}>
                Refresh metrics
              </button>
            </div>
            <p>
              Known positives are a conservative observed rate. Silence stays unknown. Groups and
              complementary counts below the configured privacy threshold are suppressed. No member
              answers appear here.
            </p>
            {!rows.length && <p>No fixed cohort yet.</p>}
            {rows.map((row) => {
              const m = row.body;
              return (
                <section className="form-stack" key={row.id}>
                  <h2>Cohort enrolled {new Date(row.started_at).toLocaleDateString()}</h2>
                  <p>
                    Policy {row.policy_version} ·{' '}
                    {row.updated_at
                      ? `Snapshot ${new Date(row.updated_at).toLocaleString()}`
                      : 'Awaiting worker snapshot'}
                  </p>
                  {m && (
                    <>
                      <p>
                        Fixed denominator: {m.denominator ?? 'suppressed'} members.{' '}
                        {m.mature
                          ? '28-day window complete.'
                          : '28-day observation window still open.'}
                      </p>
                      <Count title="Members with a mutually positive meeting" value={m.primary} />
                      {m.primary && (
                        <p>
                          {m.primary.per100?.toFixed(1)} per 100 enrolled members within 28 days.{' '}
                          Response sensitivity: {m.primary.bounds.lower}–{m.primary.bounds.upper} /{' '}
                          {m.primary.denominator} members. {m.primary.bounds.interpretation}
                        </p>
                      )}
                      <Count
                        title="Both-reported attendance / mutually confirmed plans"
                        value={m.followThrough}
                      />
                      {m.followThrough && (
                        <p>One-reported attended plans: {m.followThrough.oneReportedAttended}.</p>
                      )}
                      <Count
                        title="Members with a mutually reported second meeting / enrolled members"
                        value={m.secondMeetings}
                      />
                      <Count
                        title="Members offered an introduction within 14 days / enrolled members"
                        value={m.coverage}
                      />
                      {m.coverage && (
                        <>
                          <p>{m.coverage.observation}</p>
                          <ul>
                            {Object.entries(m.coverage.reasons).map(([name, count]) => (
                              <li key={name}>
                                {name}: {count}
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                      <Count
                        title="Voluntary meaningful-connection exits / enrolled members"
                        value={m.successes}
                      />
                      <article className="panel">
                        <h3>Consented follow-ups</h3>
                        {!m.followups.length && <p>No consented follow-ups.</p>}
                        {m.followups.map((f) => (
                          <div key={f.day}>
                            <h4>{f.day} days</h4>
                            {'suppressed' in f ? (
                              <p>Suppressed.</p>
                            ) : (
                              <>
                                <p>
                                  Continuing {f.continuing}; ended {f.ended}; abstained{' '}
                                  {f.abstained}; unknown {f.unknown}. Denominator: {f.denominator}{' '}
                                  separately consented follow-ups. Withdrawn: {f.withdrawn ?? 0};
                                  not yet due: {f.not_due ?? 0}.
                                </p>
                                <Complete value={f.completeness} />
                              </>
                            )}
                          </div>
                        ))}
                      </article>
                      <article className="panel">
                        <h3>Attention cost</h3>
                        {Object.entries(m.attention).map(([name, a]) => (
                          <div key={name}>
                            <h4>
                              {name === 'attended'
                                ? 'Attended meetings'
                                : 'Mutually positive meetings'}
                            </h4>
                            {a ? (
                              <>
                                <p>
                                  Median {a.median?.toFixed(1) ?? 'unknown'} and p90{' '}
                                  {a.p90?.toFixed(1) ?? 'unknown'} active minutes per member
                                  meeting-participation. Total {a.totalMinutes.toFixed(1)} minutes /{' '}
                                  {a.denominator} participations; {a.measuredMembers} measured
                                  members / {a.eligibleMembers} eligible members.
                                </p>
                                <Complete value={a.completeness} />
                                <p>{a.observation}</p>
                              </>
                            ) : (
                              <p>Suppressed or no optional measurements.</p>
                            )}
                          </div>
                        ))}
                      </article>
                      <article className="panel">
                        <h3>Exposure distribution</h3>
                        {m.exposure ? (
                          <>
                            <p>
                              Gini {m.exposure.gini?.toFixed(3) ?? 'unknown'}; top-decile share{' '}
                              {m.exposure.topDecileShare === null
                                ? 'unknown'
                                : `${(m.exposure.topDecileShare * 100).toFixed(1)}%`}
                              . {m.exposure.total} delivered exposures across {m.exposure.members}{' '}
                              retained members / {m.exposure.denominator} enrolled.
                            </p>
                            <Complete value={m.exposure.completeness} />
                            <p>{m.exposure.observation}</p>
                          </>
                        ) : (
                          <p>Suppressed.</p>
                        )}
                      </article>
                      <article className="panel">
                        <h3>Abuse and operations queues</h3>
                        {m.operations ? (
                          <dl>
                            {Object.entries(m.operations)
                              .filter(([, v]) => typeof v === 'number' || typeof v === 'string')
                              .map(([name, value]) => (
                                <div key={name}>
                                  <dt>{name.replaceAll(/([A-Z])/g, ' $1')}</dt>
                                  <dd>{String(value)}</dd>
                                </div>
                              ))}
                          </dl>
                        ) : (
                          <p>
                            Suppressed. Exact case-level queues remain in the audited safety
                            console. A report count is not a count of substantiated harm.
                          </p>
                        )}
                      </article>
                      <h3>Pilot gates</h3>
                      <table>
                        <caption>Configured evidence required before expansion</caption>
                        <thead>
                          <tr>
                            <th scope="col">Gate</th>
                            <th scope="col">Result</th>
                            <th scope="col">Required evidence</th>
                          </tr>
                        </thead>
                        <tbody>
                          {m.gates.map((g) => (
                            <tr key={g.name}>
                              <th scope="row">{g.name}</th>
                              <td>{g.result}</td>
                              <td>
                                {g.threshold}. {g.reason}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </section>
              );
            })}
          </>
        )}
      </section>
    </Shell>
  );
}
