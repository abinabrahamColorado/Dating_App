'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { startAuthentication } from '@simplewebauthn/browser';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { launch } from '@meetwell/config/pilot';
import { accountConfig as c } from '@meetwell/config/accounts';
import { api, messageOf, Notice } from './client';
export function AuthForm({ apply = false }: { apply?: boolean }) {
  const [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <>
      <form
        className="form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          setStatus('');
          const data = new FormData(event.currentTarget);
          try {
            const result = await api<{ message: string }>('auth/request', {
              email: data.get('email'),
              purpose: apply ? 'apply' : 'signin',
              ...(apply ? { catchment: data.get('catchment'), areaId: data.get('areaId') } : {}),
            });
            setStatus(result.message);
          } catch (e) {
            setError(messageOf(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Email address
          <input required type="email" name="email" autoComplete="email" maxLength={254} />
        </label>
        {apply && (
          <>
            <label>
              Are you in our launch catchment?
              <select required name="catchment" defaultValue="">
                <option value="" disabled>
                  Choose an option
                </option>
                <option value="launch">Manhattan, New York City</option>
                <option value="outside">Somewhere else</option>
              </select>
            </label>
            <label>
              Your broad area
              <select name="areaId" defaultValue="">
                <option value="">Choose an area</option>
                {launch.areas.map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.name}
                  </option>
                ))}
                <option value="outside">Outside these areas</option>
              </select>
            </label>
          </>
        )}
        <button disabled={busy} type="submit">
          {busy ? 'Sending…' : 'Email me a sign-in link'} <span aria-hidden="true">↗</span>
        </button>
      </form>
      {!apply && (
        <button
          className="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              const result = await api<{
                id: string;
                options: PublicKeyCredentialRequestOptionsJSON;
              }>('auth/passkey/options', { kind: 'authenticate' });
              const response = await startAuthentication({ optionsJSON: result.options });
              await api('auth/passkey/verify', { kind: 'authenticate', id: result.id, response });
              router.replace('/app');
            } catch {
              setError('Passkey sign-in did not finish. You can try again or use an email link.');
            } finally {
              setBusy(false);
            }
          }}
        >
          Sign in with a passkey
        </button>
      )}
      <Notice error={error} status={status} />
      <p className="quiet">
        Open the link in this browser. It expires after {c.MAGIC_LINK_MINUTES} minutes. No password
        needed.
      </p>
    </>
  );
}
