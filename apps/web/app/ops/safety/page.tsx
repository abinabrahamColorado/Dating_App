'use client';
import { useCallback, useEffect, useState, useRef } from 'react';
import { Shell } from '../../../components/shell';
import { api, Notice, messageOf } from '../../../components/client';
import { useSafetyCommand } from '../../../components/safety';
import { safetyConfig, severityLevels } from '@meetwell/config/safety';
import type { SafetyStore } from '@meetwell/db/safety';
type Case = Awaited<ReturnType<SafetyStore['view']>>;
type Queue = Awaited<ReturnType<SafetyStore['queue']>>;
type Appeals = Awaited<ReturnType<SafetyStore['appeals']>>;
type Switches = Awaited<ReturnType<SafetyStore['switches']>>;
type Audit = Awaited<ReturnType<SafetyStore['auditLog']>>;
function age(value: Date | string) {
  const hours = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 3600000));
  return hours < 24 ? `${hours} hours` : `${Math.floor(hours / 24)} days`;
}
export default function Page() {
  const [queue, setQueue] = useState<Queue>([]),
    [kind, setKind] = useState<'reports' | 'integrity'>('reports'),
    [page, setPage] = useState(0),
    [current, setCurrent] = useState<Case | null>(null);
  const [appeals, setAppeals] = useState<Appeals>([]),
    [switches, setSwitches] = useState<Switches | null>(null),
    [audit, setAudit] = useState<Audit>([]);
  const [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false),
    [allowed, setAllowed] = useState(false);
  const [caseStatus, setCaseStatus] = useState('IN_REVIEW'),
    [severity, setSeverity] = useState('STANDARD');
  const [scope, setScope] = useState('VENUE'),
    [target, setTarget] = useState('');
  const command = useSafetyCommand();
  const refreshSequence = useRef(0),
    caseSequence = useRef(0);
  const [accountId, setAccountId] = useState('');
  const [accountControl, setAccountControl] = useState<{
    restricted: boolean;
    version: number;
  } | null>(null);
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    caseSequence.current++;
    setQueue([]);
    setCurrent(null);
    setAccountControl(null);
    setError('');
    try {
      const [q, a, s] = await Promise.all([
        api<Queue>(`ops/safety/${kind}?page=${page}`),
        api<Appeals>(`ops/safety/appeals?page=${page}`),
        api<Switches>('ops/safety/switches'),
      ]);
      if (sequence !== refreshSequence.current) return;
      setQueue(q);
      setAppeals(a);
      setSwitches(s);
      setAllowed(true);
    } catch (e) {
      if (sequence !== refreshSequence.current) return;
      setQueue([]);
      setAppeals([]);
      setSwitches(null);
      setAudit([]);
      setAllowed(false);
      setError(messageOf(e));
    }
  }, [kind, page]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function act(path: string, data: unknown, message: string) {
    setBusy(true);
    setError('');
    try {
      await command(path, data);
      setStatus(message);
      await refresh();
    } catch (e) {
      setCurrent(null);
      setAudit([]);
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  async function view(id: string) {
    const sequence = ++caseSequence.current;
    setCurrent(null);
    setError('');
    try {
      const c = await api<Case>(`ops/safety/${kind}/${id}`);
      if (sequence !== caseSequence.current) return;
      setCurrent(c);
      setCaseStatus(c.status);
      setSeverity(c.severity);
    } catch (e) {
      if (sequence !== caseSequence.current) return;
      setError(messageOf(e));
    }
  }
  return (
    <Shell member>
      <section className="dashboard form-stack">
        <p className="eyebrow">RESTRICTED STAFF ACCESS</p>
        <h1>Safety console</h1>
        <p>
          Every case view is audited. Precautionary restrictions are temporary review measures. A
          report count never creates a permanent ban.
        </p>
        <p>{safetyConfig.SUPPORT_NOTICE}</p>
        <Notice error={error} status={status} />
        <button className="secondary" onClick={() => void refresh()}>
          Refresh console
        </button>
        {allowed && (
          <>
            <section className="panel form-stack">
              <h2>Restrict a single account</h2>
              <p>
                Use an account reference from an authorized operational record. A restriction
                preserves reporting, help and appeals.
              </p>
              <label>
                Account reference
                <input
                  value={accountId}
                  onChange={(e) => {
                    setAccountId(e.target.value);
                    setAccountControl(null);
                  }}
                />
              </label>
              <button
                className="secondary"
                disabled={!accountId || busy}
                onClick={async () => {
                  setAccountControl(null);
                  try {
                    setAccountControl(await api(`ops/safety/enforcement/${accountId}`));
                    setError('');
                  } catch (e) {
                    setError(messageOf(e));
                  }
                }}
              >
                Check account control
              </button>
              {accountControl && (
                <>
                  <p>
                    {accountControl.restricted
                      ? 'Precautionary restriction active.'
                      : 'No precautionary restriction.'}
                  </p>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(
                        'ops/safety/enforcement',
                        {
                          subjectId: accountId,
                          caseId: null,
                          version: accountControl.version,
                          restricted: !accountControl.restricted,
                        },
                        'Account control updated.',
                      )
                    }
                  >
                    {accountControl.restricted
                      ? 'Lift account restriction'
                      : 'Restrict account pending review'}
                  </button>
                </>
              )}
            </section>
            <section className="panel form-stack">
              <h2>Review queue</h2>
              <label>
                Queue
                <select
                  value={kind}
                  onChange={(e) => {
                    setCurrent(null);
                    setQueue([]);
                    caseSequence.current++;
                    setKind(e.target.value as typeof kind);
                    setPage(0);
                  }}
                >
                  <option value="reports">Safety cases</option>
                  <option value="integrity">Profile integrity</option>
                </select>
              </label>
              {!queue.length && <p>No open cases on this page.</p>}
              {queue.map((r) => (
                <article className="case-row" key={r.id}>
                  <h3>{kind === 'reports' ? r.severity : 'Integrity concern'}</h3>
                  <p>
                    {r.status.replaceAll('_', ' ')} · Case age: {age(r.created_at)}
                  </p>
                  <button className="secondary" onClick={() => void view(r.id)}>
                    Open case {r.id.slice(0, 8)}
                  </button>
                </article>
              ))}
              <div className="actions">
                <button
                  className="secondary"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous page
                </button>
                <span>Page {page + 1}</span>
                <button
                  className="secondary"
                  disabled={
                    queue.length < safetyConfig.CASE_PAGE_SIZE &&
                    appeals.length < safetyConfig.CASE_PAGE_SIZE
                  }
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next page
                </button>
              </div>
            </section>
            {current && (
              <section className="panel form-stack" aria-label="Selected case">
                <h2>Case review</h2>
                <p>Case age: {age(current.createdAt)}</p>
                <p className="report-detail">{current.detail || 'No description supplied.'}</p>
                <p>Do not infer wrongdoing from missing detail or a discrepancy alone.</p>
                <label>
                  Case status
                  <select value={caseStatus} onChange={(e) => setCaseStatus(e.target.value)}>
                    <option value="RECEIVED">Received</option>
                    <option value="IN_REVIEW">In review</option>
                    <option value="CLOSED">Closed</option>
                  </select>
                </label>
                {kind === 'reports' && (
                  <label>
                    Severity
                    <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
                      {Object.entries(severityLevels).map(([k, v]) => (
                        <option key={k} value={k}>
                          {k}: {v}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(
                      `ops/safety/${kind}/${current.id}`,
                      { version: current.version, status: caseStatus, severity },
                      'Case updated.',
                    )
                  }
                >
                  Save case review
                </button>
                {kind === 'reports' && current.subjectId && (
                  <>
                    <h3>Account access</h3>
                    <p>
                      {current.enforcement.restricted
                        ? 'A precautionary restriction is active.'
                        : 'No precautionary restriction is active.'}
                    </p>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void act(
                          'ops/safety/enforcement',
                          {
                            subjectId: current.subjectId,
                            caseId: current.id,
                            version: current.enforcement.version,
                            restricted: !current.enforcement.restricted,
                          },
                          current.enforcement.restricted
                            ? 'Restriction lifted.'
                            : 'Precautionary restriction applied.',
                        )
                      }
                    >
                      {current.enforcement.restricted
                        ? 'Lift restriction'
                        : 'Apply precautionary restriction'}
                    </button>
                  </>
                )}
              </section>
            )}
            <section className="panel form-stack">
              <h2>Appeals</h2>
              {!appeals.length && <p>No open appeals on this page.</p>}
              {appeals.map((a) => (
                <article className="case-row" key={a.id}>
                  <h3>Appeal · {age(a.createdAt)}</h3>
                  <p className="report-detail">{a.detail || 'No additional description.'}</p>
                  <div className="actions">
                    <button
                      disabled={busy}
                      onClick={() =>
                        void act(
                          `ops/safety/appeals/${a.id}`,
                          { version: a.version, decision: 'LIFTED' },
                          'Appeal reviewed; restriction lifted.',
                        )
                      }
                    >
                      Lift restriction after review
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void act(
                          `ops/safety/appeals/${a.id}`,
                          { version: a.version, decision: 'UPHELD' },
                          'Appeal reviewed; restriction upheld.',
                        )
                      }
                    >
                      Uphold after review
                    </button>
                  </div>
                </article>
              ))}
            </section>
            {switches && (
              <section className="panel form-stack">
                <h2>Safety switches</h2>
                <p>
                  Go and new-person Go are disabled by configuration. These controls can add a
                  shutdown; they cannot enable a feature disabled by configuration. Reporting and
                  help remain available.
                </p>
                {(['ALL_GO', 'NEW_PERSON_GO'] as const).map((s) => {
                  const row = switches.overrides.find((r) => r.scope === s);
                  return (
                    <div className="case-row" key={s}>
                      <h3>{s === 'ALL_GO' ? 'All Go' : 'New-person Go'}</h3>
                      <p>
                        Configuration: disabled · Console shutdown: {row?.disabled ? 'on' : 'off'}
                      </p>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          void act(
                            'ops/safety/switches',
                            {
                              scope: s,
                              target: null,
                              version: row?.version ?? 0,
                              disabled: !row?.disabled,
                            },
                            'Switch saved.',
                          )
                        }
                      >
                        {row?.disabled ? 'Clear' : 'Set'}{' '}
                        {s === 'ALL_GO' ? 'all Go' : 'new-person Go'} shutdown
                      </button>
                    </div>
                  );
                })}
                <h3>Venue and event shutdowns</h3>
                <p>
                  Save shutdowns now. Venue and event features will enforce them when those features
                  open.
                </p>
                <label>
                  Switch type
                  <select value={scope} onChange={(e) => setScope(e.target.value)}>
                    <option value="VENUE">Venue</option>
                    <option value="EVENT">Event</option>
                  </select>
                </label>
                <label>
                  Venue or event reference
                  <input
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    placeholder="Reference from the venue or event record"
                  />
                </label>
                <button
                  disabled={busy || !target}
                  onClick={() => {
                    const row = switches.overrides.find(
                      (r) => r.scope === scope && r.target === target,
                    );
                    void act(
                      'ops/safety/switches',
                      { scope, target, version: row?.version ?? 0, disabled: true },
                      'Shutdown saved.',
                    );
                  }}
                >
                  Save shutdown
                </button>
                {switches.overrides
                  .filter((r) => ['VENUE', 'EVENT'].includes(r.scope))
                  .map((s) => (
                    <div className="case-row" key={`${s.scope}:${s.target}`}>
                      <p>
                        {s.scope}: {s.target} · {s.disabled ? 'disabled' : 'shutdown cleared'}
                      </p>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          void act(
                            'ops/safety/switches',
                            { ...s, disabled: !s.disabled },
                            'Switch saved.',
                          )
                        }
                      >
                        {s.disabled ? 'Clear' : 'Set'} shutdown
                      </button>
                    </div>
                  ))}
              </section>
            )}
            <section className="panel form-stack">
              <h2>Case access audit</h2>
              <button
                className="secondary"
                onClick={async () => {
                  setAudit([]);
                  try {
                    setAudit(await api(`ops/safety/audit?page=${page}`));
                  } catch (e) {
                    setError(messageOf(e));
                  }
                }}
              >
                Review access audit
              </button>
              <ul>
                {audit.map((a) => (
                  <li key={a.id}>
                    {a.action.replaceAll('_', ' ')} · {new Date(a.created_at).toLocaleString()} ·
                    Staff/member reference: {a.actor_id}
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </section>
    </Shell>
  );
}
