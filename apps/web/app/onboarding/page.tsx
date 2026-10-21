'use client';
import { useState } from 'react';
import Link from 'next/link';
import { accountConfig as c } from '@meetwell/config/accounts';
import { Shell } from '../../components/shell';
import { useMember, api, Notice, messageOf } from '../../components/client';
import { ProfileEditor, Photos } from '../../components/profile-editor';
export default function Page() {
  const { me, error: loadError, refresh } = useMember();
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [photos, setPhotos] = useState(false);
  return (
    <Shell member>
      <section className="form-page wide">
        <p className="eyebrow">MAKE YOURSELF KNOWN</p>
        <h1>
          A little you.
          <br />
          <em>A good beginning.</em>
        </h1>
        <Notice error={loadError || error} />
        {!me ? (
          <p role="status">Loading your account…</p>
        ) : !me.registered ? (
          <>
            <p>
              First, the essentials. This pilot is for adults aged 18–30. Your birth date stays
              private; your profile will show your age.
            </p>
            <p>
              You will then add a short profile, explicit preferences and two or three photos for
              review. Optional availability can wait. Use synthetic information in this preview.
            </p>
            <form
              className="form-stack"
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                setError('');
                const form = new FormData(event.currentTarget);
                try {
                  await api('account/register', {
                    birthDate: form.get('birthDate'),
                    accepted: true,
                    termsVersion: c.TERMS_VERSION,
                    privacyVersion: c.PRIVACY_VERSION,
                  });
                  await refresh();
                } catch (e) {
                  setError(messageOf(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Birth date
                <input type="date" name="birthDate" required autoComplete="bday" />
              </label>
              <label className="check-row">
                <input type="checkbox" required />I acknowledge the development terms and privacy
                notice.
              </label>
              <p>
                <Link href="/terms" target="_blank">
                  Read terms (new tab)
                </Link>{' '}
                ·{' '}
                <Link href="/privacy" target="_blank">
                  Read privacy notice (new tab)
                </Link>
              </p>
              <button disabled={busy}>{busy ? 'Checking…' : 'Confirm eligibility'}</button>
            </form>
          </>
        ) : photos || (me.profile && me.preferences.length > 0) ? (
          <>
            <div className="progress">
              <p>Step 6 of 6 · Your photos</p>
              <progress max={6} value={6} aria-label="Profile progress" />
            </div>
            <Photos me={me} refresh={refresh} />
          </>
        ) : (
          <ProfileEditor
            me={me}
            wizard
            onSaved={async () => {
              await refresh();
              setPhotos(true);
            }}
          />
        )}
      </section>
    </Shell>
  );
}
