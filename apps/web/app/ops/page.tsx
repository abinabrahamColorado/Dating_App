'use client';
import Link from 'next/link';
import { useEffect, useState, useCallback } from 'react';
import type { Photo } from '@meetwell/db/accounts';
import { canModerate } from '@meetwell/core/accounts';
import { Shell } from '../../components/shell';
import { useMember, api, Notice, messageOf } from '../../components/client';
export default function Page() {
  const { me, error: loadError } = useMember();
  const [photos, setPhotos] = useState<Photo[]>([]),
    [error, setError] = useState('');
  const [busy, setBusy] = useState(false),
    [audit, setAudit] = useState<{ id: string; action: string; created_at: string }[]>([]);
  const permitted = me ? canModerate(me.roles) : false;
  const refresh = useCallback(async () => {
    try {
      setPhotos(await api('ops/photos'));
    } catch (e) {
      setError(messageOf(e));
    }
  }, []);
  useEffect(() => {
    if (permitted) void refresh();
  }, [permitted, refresh]);
  return (
    <Shell member>
      <section className="dashboard">
        <p className="eyebrow">OPERATIONS</p>
        <h1>
          A considered
          <br />
          <em>second look.</em>
        </h1>
        <Notice error={loadError || error} />
        <p>
          <Link href="/ops/safety">Open safety console</Link>
        </p>
        {!me ? (
          <p role="status">Checking access…</p>
        ) : !permitted ? (
          <p>
            Photo review is available to assigned operators and administrators. Safety cases require
            a separate safety reviewer role.
          </p>
        ) : (
          <>
            <p>
              Review only the photo content: a current, recognizable person; no explicit content,
              contact details, or identifying addresses. Do not infer identity traits. Approval is
              not verification. Reads and decisions are audited.
            </p>
            <button className="secondary" onClick={() => void refresh()}>
              Refresh review queue
            </button>
            {!photos.length && <p className="notice">No photos are waiting for review.</p>}
            <div className="photo-grid moderation">
              {photos.map((photo, index) => (
                <article className="panel" key={photo.id}>
                  <h2>Photo {index + 1}</h2>
                  <img
                    src={`/api/v1/ops/photos/${photo.id}`}
                    alt={`Pending profile photo ${index + 1}`}
                    width={300}
                    height={350}
                  />
                  <div className="actions">
                    {[true, false].map((approve) => (
                      <button
                        key={String(approve)}
                        className={approve ? '' : 'secondary'}
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          setError('');
                          try {
                            await api(`ops/photos/${photo.id}`, {
                              version: photo.version,
                              approve,
                            });
                            await refresh();
                          } catch (e) {
                            setError(messageOf(e));
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        {approve ? 'Approve' : 'Request replacement'}
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </div>
            {me.roles.includes('admin') && (
              <section className="panel">
                <h2>Recent access audit</h2>
                <button
                  className="secondary"
                  onClick={async () => {
                    try {
                      setAudit(await api('ops/audit'));
                    } catch (e) {
                      setError(messageOf(e));
                    }
                  }}
                >
                  Review audit log
                </button>
                <ul>
                  {audit.map((row) => (
                    <li key={row.id}>
                      {row.action.replaceAll('_', ' ').toLowerCase()} ·{' '}
                      {new Date(row.created_at).toLocaleString()}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </section>
    </Shell>
  );
}
