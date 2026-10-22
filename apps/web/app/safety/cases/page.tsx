'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Shell } from '../../../components/shell';
import { api, Notice, messageOf } from '../../../components/client';
import { useSafetyCommand } from '../../../components/safety';
import { safetyConfig } from '@meetwell/config/safety';
type Status = { id: string; status: string; kind: string; created_at: string };
type Enforcement = {
  restricted: boolean;
  version: number;
  notice: string | null;
  appeals: { id: string; status: string }[];
};
export default function Page() {
  const [rows, setRows] = useState<Status[]>([]),
    [enforcement, setEnforcement] = useState<Enforcement | null>(null),
    [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [detail, setDetail] = useState(''),
    [busy, setBusy] = useState(false);
  const command = useSafetyCommand();
  const refresh = useCallback(async () => {
    try {
      const [r, e] = await Promise.all([
        api<Status[]>('safety/cases'),
        api<Enforcement>('safety/enforcement'),
      ]);
      setRows(r);
      setEnforcement(e);
      setError('');
    } catch (e) {
      setRows([]);
      setEnforcement(null);
      setError(messageOf(e));
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <Shell member>
      <section className="dashboard form-stack">
        <h1>My reports and account review</h1>
        <Notice error={error} status={status} />
        <button className="secondary" onClick={() => void refresh()}>
          Refresh status
        </button>
        {!rows.length && <p>No reports to show.</p>}
        {rows.map((r) => (
          <article className="panel" key={r.id}>
            <h2>{r.kind === 'integrity' ? 'Profile concern' : 'Safety report'}</h2>
            <p>
              {r.status.replaceAll('_', ' ')} · {new Date(r.created_at).toLocaleDateString()}
            </p>
            <Link href={`/safety/cases/${r.id}`}>View case status</Link>
          </article>
        ))}
        {enforcement?.restricted && (
          <section className="panel form-stack">
            <h2>Request account review</h2>
            <p>{enforcement.notice}</p>
            <label>
              Anything you want the reviewer to know (optional)
              <textarea
                rows={4}
                maxLength={safetyConfig.DETAIL_MAX}
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
              />
            </label>
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await command('safety/appeal', { version: enforcement.version, detail });
                  setStatus('Your appeal was received.');
                  setDetail('');
                  await refresh();
                } catch (e) {
                  setError(messageOf(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Request review
            </button>
          </section>
        )}
        {enforcement?.appeals.map((a) => (
          <p key={a.id}>Appeal: {a.status.toLowerCase()}</p>
        ))}
        <Link href="/safety/concern">Something felt off</Link>
        <Link href="/safety/help">Get help now</Link>
      </section>
    </Shell>
  );
}
