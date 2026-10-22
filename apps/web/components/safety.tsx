'use client';
import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import { api, messageOf, Notice } from './client';
import { safetyConfig, severityLevels } from '@meetwell/config/safety';
import type { ReportInput } from '@meetwell/core/safety';

export function SafetyLink({
  subjectId,
  surface = 'settings',
}: {
  subjectId?: string;
  surface?: ReportInput['context']['surface'];
}) {
  const params = new URLSearchParams({ surface });
  if (subjectId) params.set('subject', subjectId);
  return <Link href={`/safety/concern?${params.toString()}`}>Something felt off</Link>;
}
/** Keep a failed command's UUID through retries. No narrative is persisted to
 * browser storage; successful acknowledgement is separate from refreshing data. */
export function useSafetyCommand() {
  const pending = useRef(new Map<string, string>());
  return useCallback(async <T,>(path: string, body: unknown): Promise<T> => {
    const fingerprint = `${path}:${JSON.stringify(body)}`;
    const key = pending.current.get(fingerprint) ?? crypto.randomUUID();
    pending.current.set(fingerprint, key);
    const result = await api<T>(path, body, key);
    pending.current.delete(fingerprint);
    return result;
  }, []);
}
export function ConcernForm({
  subjectId,
  surface,
}: {
  subjectId: string | null;
  surface: ReportInput['context']['surface'];
}) {
  const [detail, setDetail] = useState(''),
    [integrity, setIntegrity] = useState(''),
    [severity, setSeverity] = useState('STANDARD');
  const [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false),
    [received, setReceived] = useState<string | null>(null);
  const command = useSafetyCommand();
  async function send(kind: 'reports' | 'integrity' | 'block') {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      if (kind === 'block') {
        await command('safety/block', { subjectId });
        setStatus(
          'Blocked. You will not be shown to each other. They will not be notified. No report was filed.',
        );
      } else {
        const r = await command<{ id: string }>(`safety/${kind}`, {
          subjectId,
          detail: kind === 'integrity' ? integrity : detail,
          context: { surface },
          ...(kind === 'reports' ? { severity } : {}),
        });
        setReceived(r.id);
        setStatus(
          kind === 'integrity'
            ? 'Your profile concern was received for separate integrity review.'
            : 'Your report was received. Blocking is a separate choice.',
        );
        if (kind === 'integrity') setIntegrity('');
        else setDetail('');
      }
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="form-stack">
      <p>
        You choose what to do. You can get help, block, report, or leave without sending anything.
        Describing what happened is optional.
      </p>
      <Link className="button" href="/safety/help">
        Get help now
      </Link>
      <Notice error={error} status={status} />
      {received && (
        <Link className="button secondary" href={`/safety/cases/${received}`}>
          View case status
        </Link>
      )}
      <section className="panel form-stack">
        <h2>Report a concern</h2>
        <p>
          A report is private to the review process. We do not identify you to the person reported.
          This preview is not monitored for emergencies.
        </p>
        <label>
          Describe what happened (optional)
          <textarea
            value={detail}
            maxLength={safetyConfig.DETAIL_MAX}
            onChange={(e) => setDetail(e.target.value)}
            rows={5}
          />
        </label>
        <label>
          How urgent does this feel?
          <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="STANDARD">A concern for review</option>
            <option value="HIGH">Serious or ongoing concern</option>
            <option value="URGENT">Possible immediate harm</option>
          </select>
        </label>
        <p className="quiet">{severityLevels[severity as keyof typeof severityLevels]}</p>
        <button disabled={busy} onClick={() => void send('reports')}>
          Send report
        </button>
      </section>
      <section className="panel form-stack">
        <h2>Block independently</h2>
        {subjectId ? (
          <>
            <p>
              A block immediately prevents profile access in both directions. The other person is
              not notified.
            </p>
            <button className="secondary" disabled={busy} onClick={() => void send('block')}>
              Block this person
            </button>
          </>
        ) : (
          <p>
            Open “Something felt off” on the person’s profile to block them. You can still report
            here without their profile or account.
          </p>
        )}
      </section>
      <section className="panel form-stack">
        <h2>Something important differed from their profile</h2>
        <p>
          This optional concern goes to a separate integrity review. A discrepancy alone does not
          prove deliberate misrepresentation.
        </p>
        <label>
          Profile difference (optional)
          <textarea
            value={integrity}
            maxLength={safetyConfig.DETAIL_MAX}
            onChange={(e) => setIntegrity(e.target.value)}
            rows={3}
          />
        </label>
        <button className="secondary" disabled={busy} onClick={() => void send('integrity')}>
          Send profile concern
        </button>
      </section>
      <Link href="/safety/cases">My reports and account review</Link>
    </div>
  );
}
