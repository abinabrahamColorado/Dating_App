'use client';
import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Shell } from '../../../../components/shell';
import { api, Notice, messageOf } from '../../../../components/client';
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params),
    [row, setRow] = useState<{ status: string; kind: string; created_at: string } | null>(null),
    [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setRow(null);
    try {
      setRow(await api(`safety/cases/${id}`));
      setError('');
    } catch (e) {
      setError(messageOf(e));
    }
  }, [id]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <Shell member>
      <section className="dashboard form-stack">
        <h1>Case status</h1>
        <Notice error={error} />
        {row && (
          <article className="panel">
            <h2>{row.kind === 'integrity' ? 'Profile concern received' : 'Report received'}</h2>
            <p role="status">{row.status.replaceAll('_', ' ')}</p>
            <p>Received {new Date(row.created_at).toLocaleString()}</p>
            <p>
              Your concern is recorded. This acknowledgement is not an emergency response or a
              finding about another person. Blocking is a separate choice.
            </p>
          </article>
        )}
        <button className="secondary" onClick={() => void refresh()}>
          Refresh status
        </button>
        <Link href="/safety/cases">My reports and account review</Link>
        <Link href="/safety/help">Get help now</Link>
      </section>
    </Shell>
  );
}
