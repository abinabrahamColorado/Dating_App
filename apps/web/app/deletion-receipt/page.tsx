'use client';
import { useEffect, useState } from 'react';
import { Shell } from '../../components/shell';
import { api, Notice, messageOf } from '../../components/client';
type Receipt = {
  requestedAt: string;
  deadline: string;
  completedAt: string | null;
  status: string;
};
export default function Page() {
  const [receipt, setReceipt] = useState<Receipt | null>(null),
    [error, setError] = useState('');
  async function refresh() {
    try {
      setReceipt(await api<Receipt>('account/deletion-receipt'));
      setError('');
    } catch (e) {
      setError(messageOf(e));
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  return (
    <Shell>
      <section className="form-page form-stack">
        <h1>Your deletion receipt</h1>
        <Notice error={error} />
        {receipt && (
          <>
            <p>Your account is disabled and its sign-ins are revoked.</p>
            <dl>
              <dt>Requested</dt>
              <dd>{new Date(receipt.requestedAt).toLocaleString()}</dd>
              <dt>Active-store deadline</dt>
              <dd>{new Date(receipt.deadline).toLocaleDateString()}</dd>
              <dt>Status</dt>
              <dd>
                {receipt.completedAt
                  ? `Completed ${new Date(receipt.completedAt).toLocaleString()}`
                  : 'Pending — deletion work is queued.'}
              </dd>
            </dl>
            <p>
              Limited safety-case records may remain in the restricted safety store under the
              published retention policy and any case-specific legal hold. This standard notice does
              not indicate whether any case exists.
            </p>
            <p>
              Encrypted backups expire within 30 days. Deletion records are reapplied before a
              restored database can serve member data. Messages already received outside this
              service cannot be recalled.
            </p>
            <p>
              This browser holds a private receipt key. Clearing its cookies removes access to this
              receipt.
            </p>
          </>
        )}
        <button onClick={() => void refresh()}>Refresh status</button>
      </section>
    </Shell>
  );
}
