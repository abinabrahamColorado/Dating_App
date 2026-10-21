'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Shell } from '../../components/shell';
import { api, messageOf, Notice } from '../../components/client';
export default function Page() {
  const [token, setToken] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const router = useRouter();
  useEffect(() => {
    const incoming = window.location.hash.slice(1);
    if (incoming) setToken(incoming);
    window.history.replaceState(null, '', '/verify');
  }, []);
  return (
    <Shell>
      <section className="form-page">
        <p className="eyebrow">YOUR SIGN-IN LINK</p>
        <h1>
          Ready when
          <br />
          <em>you are.</em>
        </h1>
        <p>Continue in the browser where you requested this link.</p>
        <button
          disabled={!token || busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await api('auth/consume', { token });
              router.replace('/app');
            } catch (e) {
              setError(messageOf(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Signing in…' : 'Continue securely'}
        </button>
        <Notice error={error} />
        <Link href="/signin">Request another link</Link>
      </section>
    </Shell>
  );
}
