'use client';
import { useState } from 'react';
import Link from 'next/link';
import { launch, pilot } from '@meetwell/config/pilot';
import {
  genders,
  intentions,
  structures,
  intentionLabels,
  structureLabels,
  transportModes,
  interests,
  smokingValues,
  preferenceLabels,
  accountConfig as c,
} from '@meetwell/config/accounts';
import {
  profileSchema,
  preferencesSchema,
  initialPreferences,
  type Profile,
  type Preferences,
} from '@meetwell/core/accounts';
import { api, messageOf, Notice, type Me } from './client';

const labels: Record<string, string> = {
  woman: 'Women',
  man: 'Men',
  nonbinary: 'Nonbinary people',
  ...intentionLabels,
  ...structureLabels,
  no: 'No',
  sometimes: 'Sometimes',
  yes: 'Yes',
  'not-stated': 'Prefer not to say',
  walk: 'Walking',
  transit: 'Public transit',
  bike: 'Cycling',
  drive: 'Driving',
};
const steps = [
  'A little about you',
  'Where life happens',
  'Something to talk about',
  'Your boundaries',
  'Room in your week',
];
function selectOptions(values: readonly string[]) {
  return (
    <>
      <option value="" disabled>
        Choose an option
      </option>
      {values.map((v) => (
        <option key={v} value={v}>
          {labels[v] ?? v}
        </option>
      ))}
    </>
  );
}
function Choice({
  title,
  values,
  value,
  update,
}: {
  title: string;
  values: readonly string[];
  value: { setting: 'HARD' | 'STRONG' | 'NONE'; values: string[] };
  update: (v: { setting: 'HARD' | 'STRONG' | 'NONE'; values: string[] }) => void;
}) {
  return (
    <fieldset>
      <legend>{title}</legend>
      <label>
        How should we use this preference?
        <select
          value={value.setting}
          onChange={(e) => update({ ...value, setting: e.target.value as typeof value.setting })}
        >
          {Object.entries(preferenceLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="chips">
        {values.map((v) => (
          <label className="chip" key={v}>
            <input
              type="checkbox"
              checked={value.values.includes(v)}
              onChange={(e) =>
                update({
                  ...value,
                  values: e.target.checked
                    ? [...value.values, v]
                    : value.values.filter((item) => item !== v),
                })
              }
            />
            <span>{labels[v] ?? v}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
export function ProfileEditor({
  me,
  wizard = false,
  onSaved,
}: {
  me: Me;
  wizard?: boolean;
  onSaved: () => Promise<void>;
}) {
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<Partial<Profile>>(
    me.profile?.data ?? {
      interests: [],
      smoking: 'not-stated',
      availability: { flexible: false, windows: [] },
    },
  );
  const [preferences, setPreferences] = useState<Preferences>(
    me.preferences[0]?.data ?? structuredClone(initialPreferences),
  );
  const [profileVersion, setProfileVersion] = useState(me.profile?.version ?? 0);
  const [preferenceVersion, setPreferenceVersion] = useState(me.preferences[0]?.version ?? 0);
  const [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false);
  const show = (index: number) => !wizard || step === index;
  const set = <K extends keyof Profile>(field: K, value: Profile[K]) =>
    setProfile((p) => ({ ...p, [field]: value }));
  const availability = profile.availability ?? { flexible: false, windows: [] };
  const time = (n: number) =>
    `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
  const minutes = (s: string) => {
    const [h, m] = s.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  return (
    <form
      className="form-stack"
      onSubmit={async (event) => {
        event.preventDefault();
        setError('');
        setStatus('');
        if (wizard && step < steps.length - 1) {
          if (step === 2 && !profileSchema.shape.interests.safeParse(profile.interests).success) {
            setError(
              `Choose ${pilot.ONBOARDING_MIN_INTERESTS}–${pilot.ONBOARDING_MAX_INTERESTS} interests.`,
            );
            return;
          }
          if (step === 3 && !preferencesSchema.safeParse(preferences).success) {
            setError(
              'Choose who you want to meet and at least one value for each active preference.',
            );
            return;
          }
          setStep(step + 1);
          return;
        }
        const p = profileSchema.safeParse(profile),
          pref = preferencesSchema.safeParse(preferences);
        if (!p.success || !pref.success) {
          setError('Check all required fields, interests, boundaries and availability windows.');
          return;
        }
        setBusy(true);
        try {
          const saved = await api<{ version: number }>('profile', {
            version: profileVersion,
            data: p.data,
          });
          setProfileVersion(saved.version);
          const savedPrefs = await api<{ version: number }>('preferences', {
            version: preferenceVersion,
            data: pref.data,
          });
          setPreferenceVersion(savedPrefs.version);
          setStatus('Your profile and preferences are saved.');
          await onSaved();
        } catch (e) {
          setError(messageOf(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      {wizard && (
        <div className="progress">
          <p>
            Step {step + 1} of {steps.length + 1} · {steps[step]}
          </p>
          <progress max={steps.length + 1} value={step + 1} aria-label="Profile progress" />
        </div>
      )}
      {show(0) && (
        <fieldset>
          <legend>A little about you</legend>
          <label>
            Chosen display name
            <input
              required
              maxLength={c.DISPLAY_NAME_MAX}
              autoComplete="given-name"
              value={profile.displayName ?? ''}
              onChange={(e) => set('displayName', e.target.value)}
            />
          </label>
          <p>Your profile will show age {me.age}. Your birth date stays private.</p>
          <label>
            I describe my gender as
            <select
              required
              value={profile.gender ?? ''}
              onChange={(e) => set('gender', e.target.value as Profile['gender'])}
            >
              <option value="" disabled>
                Choose an option
              </option>
              <option value="woman">Woman</option>
              <option value="man">Man</option>
              <option value="nonbinary">Nonbinary</option>
            </select>
          </label>
          <p className="quiet">
            Used only as you state it, for mutual eligibility. Never inferred from a photo or
            behavior.
          </p>
          <label>
            Relationship intention
            <select
              required
              value={profile.intention ?? ''}
              onChange={(e) => set('intention', e.target.value as Profile['intention'])}
            >
              {selectOptions(intentions)}
            </select>
          </label>
          <label>
            Relationship structure
            <select
              required
              value={profile.structure ?? ''}
              onChange={(e) => set('structure', e.target.value as Profile['structure'])}
            >
              {selectOptions(structures)}
            </select>
          </label>
        </fieldset>
      )}
      {show(1) && (
        <fieldset>
          <legend>Where life happens</legend>
          <label>
            Your broad area
            <select
              required
              value={profile.areaId ?? ''}
              onChange={(e) => set('areaId', e.target.value)}
            >
              <option value="" disabled>
                Choose an area
              </option>
              {launch.areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <p className="quiet">An area you choose, never GPS or your street address.</p>
          <label>
            Maximum travel time, in minutes
            <input
              required
              type="number"
              min={1}
              max={c.MAX_TRAVEL_MINUTES}
              value={profile.travelMinutes ?? ''}
              onChange={(e) => set('travelMinutes', Number(e.target.value))}
            />
          </label>
          <label>
            How you would travel
            <select
              required
              value={profile.transport ?? ''}
              onChange={(e) => set('transport', e.target.value as Profile['transport'])}
            >
              {selectOptions(transportModes)}
            </select>
          </label>
        </fieldset>
      )}
      {show(2) && (
        <fieldset>
          <legend>Something to talk about</legend>
          <p>
            Choose {pilot.ONBOARDING_MIN_INTERESTS}–{pilot.ONBOARDING_MAX_INTERESTS} interests.
          </p>
          <div className="chips">
            {interests.map((value) => (
              <label key={value} className="chip">
                <input
                  type="checkbox"
                  checked={profile.interests?.includes(value) ?? false}
                  onChange={(e) =>
                    set(
                      'interests',
                      e.target.checked
                        ? [...(profile.interests ?? []), value]
                        : (profile.interests ?? []).filter((v) => v !== value),
                    )
                  }
                />
                <span>{value}</span>
              </label>
            ))}
          </div>
          <label>
            A small thing that makes my day…
            <textarea
              required
              maxLength={c.PROMPT_MAX}
              value={profile.prompt ?? ''}
              onChange={(e) => set('prompt', e.target.value)}
            />
          </label>
          <label>
            Do you smoke? (optional)
            <select
              value={profile.smoking}
              onChange={(e) => set('smoking', e.target.value as Profile['smoking'])}
            >
              {selectOptions(smokingValues)}
            </select>
          </label>
        </fieldset>
      )}
      {show(3) && (
        <section className="form-stack" aria-label="Preferences">
          <fieldset>
            <legend>Who would you like to meet?</legend>
            <p>Choose all that apply. Introductions must work in both directions.</p>
            <div className="chips">
              {genders.map((g) => (
                <label className="chip" key={g}>
                  <input
                    type="checkbox"
                    checked={preferences.whoToMeet.includes(g)}
                    onChange={(e) =>
                      setPreferences({
                        ...preferences,
                        whoToMeet: e.target.checked
                          ? [...preferences.whoToMeet, g]
                          : preferences.whoToMeet.filter((v) => v !== g),
                      })
                    }
                  />
                  <span>{labels[g]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Age preference</legend>
            <label>
              How should we use your age preference?
              <select
                value={preferences.age.setting}
                onChange={(e) =>
                  setPreferences({
                    ...preferences,
                    age: {
                      ...preferences.age,
                      setting: e.target.value as Preferences['age']['setting'],
                    },
                  })
                }
              >
                {Object.entries(preferenceLabels).map(([key, label]) => (
                  <option value={key} key={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-row">
              {(['min', 'max'] as const).map((bound) => (
                <label key={bound}>
                  {bound === 'min' ? 'Minimum age' : 'Maximum age'}
                  <input
                    required
                    type="number"
                    min={launch.minimumAge}
                    max={launch.maximumAge}
                    value={preferences.age[bound]}
                    onChange={(e) =>
                      setPreferences({
                        ...preferences,
                        age: { ...preferences.age, [bound]: Number(e.target.value) },
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </fieldset>
          <Choice
            title="Their relationship intention"
            values={intentions}
            value={preferences.intention}
            update={(v) =>
              setPreferences({ ...preferences, intention: v as Preferences['intention'] })
            }
          />
          <Choice
            title="Their relationship structure"
            values={structures}
            value={preferences.structure}
            update={(v) =>
              setPreferences({ ...preferences, structure: v as Preferences['structure'] })
            }
          />
          <Choice
            title="Their smoking preference"
            values={['no', 'sometimes', 'yes']}
            value={preferences.smoking}
            update={(v) => setPreferences({ ...preferences, smoking: v as Preferences['smoking'] })}
          />
          <p className="quiet">
            Only you can change a hard boundary. “No preference” does not change who-to-meet
            eligibility or the adult-only rule.
          </p>
        </section>
      )}
      {show(4) && (
        <fieldset>
          <legend>Room in your week (optional)</legend>
          <p>
            You can skip this now. Availability helps find a feasible next step later. Times use{' '}
            {launch.timezone}.
          </p>
          <label className="check-row">
            <input
              type="checkbox"
              checked={availability.flexible}
              onChange={(e) => set('availability', { ...availability, flexible: e.target.checked })}
            />
            I’m flexible this week
          </label>
          {availability.windows.map((window, index) => (
            <div className="window-row" key={index}>
              <label>
                Day {index + 1}
                <select
                  value={window.day}
                  onChange={(e) =>
                    set('availability', {
                      ...availability,
                      windows: availability.windows.map((v, i) =>
                        i === index ? { ...v, day: Number(e.target.value) } : v,
                      ),
                    })
                  }
                >
                  {[
                    'Sunday',
                    'Monday',
                    'Tuesday',
                    'Wednesday',
                    'Thursday',
                    'Friday',
                    'Saturday',
                  ].map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              {(['start', 'end'] as const).map((bound) => (
                <label key={bound}>
                  {bound === 'start' ? 'From' : 'Until'} {index + 1}
                  <input
                    type="time"
                    required
                    value={time(window[bound])}
                    onChange={(e) =>
                      set('availability', {
                        ...availability,
                        windows: availability.windows.map((v, i) =>
                          i === index ? { ...v, [bound]: minutes(e.target.value) } : v,
                        ),
                      })
                    }
                  />
                </label>
              ))}
              <button
                type="button"
                className="secondary"
                aria-label={`Remove window ${index + 1}`}
                onClick={() =>
                  set('availability', {
                    ...availability,
                    windows: availability.windows.filter((_, i) => i !== index),
                  })
                }
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="secondary"
            disabled={availability.windows.length >= c.MAX_WEEKLY_WINDOWS}
            onClick={() =>
              set('availability', {
                ...availability,
                windows: [...availability.windows, { day: 6, start: 600, end: 660 }],
              })
            }
          >
            Add a weekly window
          </button>
        </fieldset>
      )}
      <Notice error={error} status={status} />
      <div className="actions">
        {wizard && step > 0 && (
          <button className="secondary" type="button" onClick={() => setStep(step - 1)}>
            Back
          </button>
        )}
        <button disabled={busy} type="submit">
          {busy
            ? 'Saving…'
            : wizard && step < steps.length - 1
              ? 'Continue'
              : wizard
                ? 'Save and add photos'
                : 'Save profile & preferences'}
        </button>
      </div>
    </form>
  );
}
export function Photos({ me, refresh }: { me: Me; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <section className="form-stack">
      <h2>Your photos</h2>
      <p>
        Add {pilot.PROFILE_MIN_PHOTOS}–{pilot.PROFILE_MAX_PHOTOS} current photos. You can see your
        uploads; others cannot see them until review. Review may take longer than onboarding.
      </p>
      <div className="photo-grid">
        {me.photos.map((photo, index) => (
          <figure key={photo.id}>
            <img
              src={`/api/v1/photos/${photo.id}`}
              alt={`Your profile photo ${index + 1}`}
              width={240}
              height={280}
            />
            <figcaption>
              {photo.status === 'PENDING'
                ? 'Awaiting review'
                : photo.status === 'APPROVED'
                  ? 'Approved'
                  : 'Please replace this photo'}
            </figcaption>
            <button
              disabled={busy}
              className="secondary"
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await api(`photos/${photo.id}/remove`, {});
                  await refresh();
                } catch (e) {
                  setError(messageOf(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Remove photo {index + 1}
            </button>
          </figure>
        ))}
      </div>
      {me.photos.length < pilot.PROFILE_MAX_PHOTOS && (
        <label className="upload">
          Add a photo
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              e.target.value = '';
              setBusy(true);
              setError('');
              try {
                if (file.size > c.PHOTO_MAX_BYTES)
                  throw new Error('Choose a photo smaller than 8 MB.');
                const response = await fetch('/api/v1/photos', {
                  method: 'POST',
                  headers: { 'Content-Type': file.type, 'Idempotency-Key': crypto.randomUUID() },
                  body: file,
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error);
                await refresh();
              } catch (e) {
                setError(messageOf(e));
              } finally {
                setBusy(false);
              }
            }}
          />
          <span className="quiet">
            JPEG, PNG or WebP · up to {c.PHOTO_MAX_BYTES / 1_000_000} MB · metadata is removed
          </span>
        </label>
      )}
      {busy && <p role="status">Updating your photos…</p>}
      <Notice error={error} />
      <Link href="/app">
        View my profile <span aria-hidden="true">↗</span>
      </Link>
    </section>
  );
}
