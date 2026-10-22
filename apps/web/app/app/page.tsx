'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Shell } from '../../components/shell';
import { useMember, api, Notice, messageOf } from '../../components/client';
import { pilot } from '@meetwell/config/pilot';
import { SafetyLink } from '../../components/safety';
export default function Page() {
  const { me, error: loadError, refresh } = useMember();
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const router = useRouter();
  useEffect(() => {
    if (me && (!me.registered || !me.profile || !me.preferences.length))
      router.replace('/onboarding');
  }, [me, router]);
  const profile = me?.profile?.data;
  const approved = me?.photos.filter((p) => p.status === 'APPROVED').length ?? 0;
  return (
    <Shell member>
      <section className="dashboard">
        <p className="eyebrow">YOUR SPACE</p>
        <h1>{profile ? `Hello, ${profile.displayName}.` : 'Welcome.'}</h1>
        <Notice error={loadError || error} />
        {!me || !profile ? (
          <p role="status">Getting your profile…</p>
        ) : (
          <>
            <div className="dashboard-grid">
              <article className="panel profile-preview">
                <p className="eyebrow">YOUR PROFILE PREVIEW</p>
                <div className="photo-grid">
                  {me.photos.map((photo, i) => (
                    <figure key={photo.id}>
                      <img
                        src={`/api/v1/photos/${photo.id}`}
                        alt={`Your profile photo ${i + 1}`}
                        width={240}
                        height={280}
                      />
                      <figcaption>
                        {photo.status === 'APPROVED'
                          ? 'Approved'
                          : photo.status === 'PENDING'
                            ? 'Private · awaiting approval'
                            : 'Private · please replace this photo'}
                      </figcaption>
                    </figure>
                  ))}
                </div>
                <h2>
                  {profile.displayName}, {me.age}
                </h2>
                <p>
                  {profile.intention.replace('-', ' ')} · {profile.structure.replace('-', ' ')}
                </p>
                <div className="tags">
                  {profile.interests.map((interest) => (
                    <span key={interest}>{interest}</span>
                  ))}
                </div>
                <p className="eyebrow">A SMALL THING THAT MAKES MY DAY</p>
                <p className="prompt-answer">{profile.prompt}</p>
                <Link href="/settings">Edit profile and preferences</Link>
                <p>
                  <SafetyLink surface="profile" />
                </p>
              </article>
              <aside className="form-stack">
                <div className="panel">
                  <p className="eyebrow">AT YOUR PACE</p>
                  <h2>
                    {me.policy.state === 'ACTIVE'
                      ? me.policy.intent === 'FOCUS'
                        ? 'Space to focus.'
                        : 'Your profile is ready.'
                      : me.policy.state === 'ONBOARDING'
                        ? 'A careful beginning.'
                        : `Account ${me.policy.state.toLowerCase()}.`}
                  </h2>
                  {!me.cohortEligible && (
                    <p>
                      New introductions are limited to the pilot age range. Your account controls
                      remain available.
                    </p>
                  )}
                  {approved < pilot.PROFILE_MIN_PHOTOS ? (
                    <>
                      <p>
                        Your profile will remain out of discovery until at least{' '}
                        {pilot.PROFILE_MIN_PHOTOS} photos are approved.
                      </p>
                      <Link href="/onboarding">Add or review photos</Link>
                    </>
                  ) : (
                    me.policy.state === 'ONBOARDING' && (
                      <button
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          setError('');
                          try {
                            await api('account/policy', {
                              action: 'ACTIVATE',
                              version: me.policy.version,
                            });
                            await refresh();
                          } catch (e) {
                            setError(messageOf(e));
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Complete onboarding
                      </button>
                    )
                  )}
                  <p>Nearby off</p>
                  <p className="quiet">No GPS or nearby introductions.</p>
                  <button className="secondary" onClick={() => void refresh()}>
                    Refresh status
                  </button>
                </div>
                <div className="notice">
                  <strong>Introductions are not open yet.</strong>
                  <p>
                    This development preview is for synthetic profiles. We’ll finish safety, meeting
                    and deletion flows before a live pilot.
                  </p>
                </div>
                {me.roles.length > 0 && <Link href="/ops">Open operator console</Link>}
              </aside>
            </div>
          </>
        )}
      </section>
    </Shell>
  );
}
