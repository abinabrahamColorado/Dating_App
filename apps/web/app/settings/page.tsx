'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
} from '@simplewebauthn/browser';
import type { PolicyCommand } from '@meetwell/core/accounts';
import { Shell } from '../../components/shell';
import { useMember, api, Notice, messageOf } from '../../components/client';
import { ProfileEditor, Photos } from '../../components/profile-editor';
export default function Page() {
  const { me, error: loadError, refresh } = useMember();
  const [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false);
  const [pauseChat, setPauseChat] = useState(false),
    [reminders, setReminders] = useState(false);
  const [exitReason, setExitReason] = useState(''),
    [deleteConfirm, setDeleteConfirm] = useState(false);
  const [sessions, setSessions] = useState<{ id: string; current: boolean; createdAt: string }[]>(
    [],
  );
  const router = useRouter();
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      await task();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  async function policy(action: PolicyCommand['action']) {
    if (!me) return;
    await api('account/policy', {
      action,
      version: me.policy.version,
      ...(action === 'PAUSE' ? { pauseChat, planReminders: reminders } : {}),
      ...(action === 'EXIT' && exitReason ? { exitReason } : {}),
    });
    if (action === 'DELETE') router.replace('/signin');
    else {
      setStatus('Your account choice is saved.');
      await refresh();
    }
  }
  return (
    <Shell member>
      <section className="form-page wide">
        <p className="eyebrow">YOUR CHOICES</p>
        <h1>
          Keep it
          <br />
          <em>on your terms.</em>
        </h1>
        <Notice error={loadError || error} status={status} />
        {!me ? (
          <p role="status">Loading settings…</p>
        ) : (
          <>
            <section className="panel form-stack">
              <h2>Account & discovery</h2>
              <p>
                Account: {me.policy.state.toLowerCase()} · Intent: {me.policy.intent.toLowerCase()}{' '}
                · Nearby off
              </p>
              <p>
                Focus stops new romantic introductions. Pause stops discovery. Existing connections
                can remain by your choice when messaging becomes available.
              </p>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={pauseChat}
                  onChange={(e) => setPauseChat(e.target.checked)}
                />
                Keep existing chats while paused
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={reminders}
                  onChange={(e) => setReminders(e.target.checked)}
                />
                Keep reminders for retained plans while paused
              </label>
              <div className="actions">
                {me.policy.state === 'ACTIVE' && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(() => policy(me.policy.intent === 'FOCUS' ? 'EXPLORE' : 'FOCUS'))
                    }
                  >
                    {me.policy.intent === 'FOCUS' ? 'Return to Explore' : 'Choose Focus'}
                  </button>
                )}
                {['ACTIVE', 'ONBOARDING'].includes(me.policy.state) && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void run(() => policy('PAUSE'))}
                  >
                    Pause account
                  </button>
                )}
                {me.policy.state === 'PAUSED' && (
                  <button disabled={busy} onClick={() => void run(() => policy('RESUME'))}>
                    Resume after eligibility check
                  </button>
                )}
              </div>
              <label>
                Exit reason (optional)
                <select value={exitReason} onChange={(e) => setExitReason(e.target.value)}>
                  <option value="">Prefer not to say</option>
                  <option value="met-someone-here">I met someone here</option>
                  <option value="taking-a-break">Taking a break</option>
                  <option value="other">Another reason</option>
                </select>
              </label>
              <p>
                Exit closes discovery. Returning needs a fresh eligibility review; it is not a
                pause.
              </p>
              <button
                className="secondary"
                disabled={busy || me.policy.state === 'EXITED'}
                onClick={() => void run(() => policy('EXIT'))}
              >
                Exit the service
              </button>
            </section>
            {me.registered && !['EXITED', 'RESTRICTED'].includes(me.policy.state) && (
              <>
                <details>
                  <summary>Edit profile, preferences & availability</summary>
                  <ProfileEditor key={me.profile?.version ?? 0} me={me} onSaved={refresh} />
                </details>
                <details>
                  <summary>Photos & review status</summary>
                  <Photos me={me} refresh={refresh} />
                </details>
                <details>
                  <summary>Preference history</summary>
                  {me.preferences.length ? (
                    me.preferences.map((v) => (
                      <article className="history" key={v.version}>
                        <h3>Version {v.version}</h3>
                        <p>
                          {new Date(v.updatedAt).toLocaleString()} · Your edit · Future
                          introductions
                        </p>
                        <p>
                          Who to meet:{' '}
                          {v.data.whoToMeet
                            .map((v) =>
                              v === 'woman' ? 'women' : v === 'man' ? 'men' : 'nonbinary people',
                            )
                            .join(', ')}
                        </p>
                        <p>
                          Age: {v.data.age.min}–{v.data.age.max} ({v.data.age.setting.toLowerCase()}
                          )
                        </p>
                        {(['intention', 'structure', 'smoking'] as const).map((field) => (
                          <p key={field}>
                            {field}: {v.data[field].setting.toLowerCase()} ·{' '}
                            {v.data[field].values.join(', ') || 'No values selected'}
                          </p>
                        ))}
                      </article>
                    ))
                  ) : (
                    <p>No preference edits yet.</p>
                  )}
                </details>
              </>
            )}
            <section className="panel form-stack">
              <h2>Sign-in & devices</h2>
              <p>
                Add an optional passkey after a fresh sign-in. Your device handles the private key.
              </p>
              <button
                className="secondary"
                disabled={busy || !me.registered}
                onClick={() =>
                  void run(async () => {
                    const options = await api<{
                      id: string;
                      options: PublicKeyCredentialCreationOptionsJSON;
                    }>('auth/passkey/options', { kind: 'register' });
                    const response = await startRegistration({ optionsJSON: options.options });
                    await api('auth/passkey/verify', {
                      kind: 'register',
                      id: options.id,
                      response,
                    });
                    setStatus('Passkey added.');
                  })
                }
              >
                Add a passkey
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void run(async () => setSessions(await api('account/sessions')))}
              >
                View active sessions
              </button>
              {sessions.length > 0 && (
                <ul>
                  {sessions.map((s) => (
                    <li key={s.id}>
                      {s.current ? 'This session' : 'Another session'} · signed in{' '}
                      {new Date(s.createdAt).toLocaleString()}
                    </li>
                  ))}
                </ul>
              )}
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api('account/sessions/revoke-others', {});
                    setSessions(await api('account/sessions'));
                    setStatus('Other sessions signed out.');
                  })
                }
              >
                Sign out other devices
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api('auth/signout', {});
                    router.replace('/signin');
                  })
                }
              >
                Sign out
              </button>
              <Link href="/signin">Sign in again for a sensitive change</Link>
            </section>
            <section className="panel form-stack">
              <h2>Request account deletion</h2>
              <p>
                This immediately disables your account and signs out every device. Data erasure is a
                later milestone; this preview is for synthetic data only.
              </p>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.checked)}
                />
                I want to disable my account and request deletion.
              </label>
              <button
                className="danger"
                disabled={!deleteConfirm || busy}
                onClick={() => void run(() => policy('DELETE'))}
              >
                Request deletion
              </button>
            </section>
          </>
        )}
      </section>
    </Shell>
  );
}
