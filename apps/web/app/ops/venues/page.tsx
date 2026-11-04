'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  venueWriteSchema,
  activities,
  accessFeatures,
  type VenueDetails,
} from '@meetwell/core/connections';
import { launch } from '@meetwell/config/pilot';
import type { VenueStore } from '@meetwell/db/venues';
import { Shell } from '../../../components/shell';
import { api, Notice, messageOf, useMember } from '../../../components/client';
import { useSafetyCommand } from '../../../components/safety';
type Row = Awaited<ReturnType<VenueStore['list']>>[number];
const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const publicText = [
  ['address', 'Public address'],
  ['entrance', 'Public entrance'],
  ['permittedMeetingArea', 'Permitted meeting area'],
  ['transit', 'Transit access'],
  ['emergencyExitNotes', 'Emergency exit notes'],
  ['checks', 'Checks completed and limitations'],
] as const;
const privateText = [
  ['partnerContact', 'Partner staff contact', 1000],
  ['trainingStatus', 'Partner training status', 1000],
  ['complaintHistory', 'Operational complaint history', 4000],
] as const;
const flags = [
  ['seating', 'Seating available'],
  ['noPurchase', 'No purchase required'],
  ['alcoholFree', 'Alcohol-free options available'],
  ['staffed', 'Staff present during listed hours'],
  ['liveSessionEligible', 'Eligible for future live sessions'],
] as const;
function clock(value: string) {
  const [h, m] = value.split(':').map(Number);
  return h! * 60 + m!;
}
function timeOf(n: number) {
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}
export default function Page() {
  const { me, error: memberError } = useMember(),
    [rows, setRows] = useState<Row[]>([]),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState<Row | null>(null),
    [editing, setEditing] = useState(false),
    [newId, setNewId] = useState('');
  const [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false);
  const command = useSafetyCommand(),
    permitted = me?.roles.some((r) => r === 'operator' || r === 'admin');
  const refresh = useCallback(async () => {
    try {
      setRows(await api<Row[]>(`ops/venues?page=${page}`));
      setError('');
    } catch (e) {
      setError(messageOf(e));
    }
  }, [page]);
  useEffect(() => {
    if (permitted) void refresh();
  }, [permitted, refresh]);
  function edit(row: Row | null) {
    setSelected(row);
    setNewId(crypto.randomUUID());
    setEditing(true);
    setError('');
    setStatus('');
  }
  async function save(form: HTMLFormElement) {
    const f = new FormData(form),
      s = (key: string) => String(f.get(key) ?? ''),
      b = (key: string) => f.has(key);
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const value = {
        id: selected?.id ?? newId,
        version: selected?.version ?? 0,
        name: s('name'),
        latitude: Number(f.get('latitude')),
        longitude: Number(f.get('longitude')),
        approved: b('approved'),
        humanReviewed: b('humanReviewed'),
        alcoholPrimary: b('alcoholPrimary'),
        reviewExpiresAt: `${s('reviewExpiresAt')}T23:59:59Z`,
        details: {
          ...Object.fromEntries(publicText.map(([key]) => [key, s(key)])),
          category: s('category'),
          timezone: s('timezone'),
          hours: days.flatMap((_, day) =>
            b(`day-${day}`)
              ? [{ day, start: clock(s(`start-${day}`)), end: clock(s(`end-${day}`)) }]
              : [],
          ),
          liveSessionEligible: b('liveSessionEligible'),
          accessibility: {
            entrance: b('access-entrance'),
            seating: b('access-seating'),
            toilets: b('access-toilets'),
            details: s('access-details'),
          },
          seating: b('seating'),
          noPurchase: b('noPurchase'),
          costBand: Number(f.get('costBand')),
          alcoholFree: b('alcoholFree'),
          staffed: b('staffed'),
          activities: f.getAll('activity'),
          reviewDate: s('reviewDate'),
        },
        partnered: b('partnered'),
        ...Object.fromEntries(privateText.map(([key]) => [key, s(key)])),
      };
      const parsed = venueWriteSchema.safeParse(value);
      if (!parsed.success)
        throw new Error(parsed.error.issues[0]?.message ?? 'Review the venue fields.');
      await command('ops/venues', parsed.data);
      setEditing(false);
      setSelected(null);
      setStatus(
        'Venue review saved. Affected plans require a new proposal and both confirmations.',
      );
      await refresh();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  const details = selected?.details as VenueDetails | null | undefined;
  return (
    <Shell member>
      <section className="dashboard">
        <p className="eyebrow">OPERATIONS</p>
        <h1>Approved public meeting places</h1>
        <p>
          <Link href="/ops">Back to operations</Link>
          {' · '}
          <Link href="/ops/safety">Safety and venue switches</Link>
        </p>
        <Notice error={memberError || error} status={status} />
        {!me ? (
          <p>Checking access…</p>
        ) : !permitted ? (
          <p>Venue management requires an operator or administrator assignment.</p>
        ) : (
          <>
            <p>
              Review permitted public meeting areas and publish the actual checks. Approval does not
              promise supervision or safety. Never approve a private home, hotel room, isolated
              trail or sensitive service location.
            </p>
            <button onClick={() => edit(null)}>Add a public meeting place</button>
            <ul className="intro-list">
              {rows.map((r) => (
                <li key={r.id}>
                  <strong>{r.name}</strong>
                  <span>
                    {r.disabled
                      ? 'Disabled by safety switch'
                      : r.approved
                        ? 'Approved'
                        : 'Awaiting approval'}
                  </span>
                  <span>Venue ID for safety controls: {r.id}</span>
                  <button className="secondary" onClick={() => edit(r)}>
                    Review {r.name}
                  </button>
                </li>
              ))}
            </ul>
            <div className="actions">
              <button
                className="secondary"
                disabled={page === 0}
                onClick={() => setPage((v) => v - 1)}
              >
                Previous venues
              </button>
              <button
                className="secondary"
                disabled={!rows.length}
                onClick={() => setPage((v) => v + 1)}
              >
                More venues
              </button>
            </div>
            {editing && (
              <form
                key={`${selected?.id ?? newId}:${selected?.version ?? 0}`}
                className="panel form-stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save(e.currentTarget);
                }}
              >
                <h2>{selected ? 'Review meeting place' : 'New meeting place'}</h2>
                <label>
                  Venue name
                  <input name="name" required maxLength={120} defaultValue={selected?.name ?? ''} />
                </label>
                {publicText.map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <textarea
                      name={key}
                      required
                      maxLength={1000}
                      defaultValue={details?.[key] ?? ''}
                    />
                  </label>
                ))}
                <label>
                  Public place type
                  <select name="category" defaultValue={details?.category ?? 'cafe'}>
                    <option value="cafe">Cafe</option>
                    <option value="library">Library meeting area</option>
                    <option value="student-union">Student union meeting area</option>
                    <option value="mall">Mall meeting area</option>
                    <option value="public-park">Busy public park meeting area</option>
                    <option value="civic-space">Public civic space</option>
                  </select>
                </label>
                <fieldset>
                  <legend>Public venue map point</legend>
                  <p>Use the venue’s public entrance, never a member’s location.</p>
                  <label>
                    Latitude
                    <input
                      name="latitude"
                      type="number"
                      step="any"
                      min={-90}
                      max={90}
                      required
                      defaultValue={selected?.latitude ?? ''}
                    />
                  </label>
                  <label>
                    Longitude
                    <input
                      name="longitude"
                      type="number"
                      step="any"
                      min={-180}
                      max={180}
                      required
                      defaultValue={selected?.longitude ?? ''}
                    />
                  </label>
                </fieldset>
                <label>
                  Opening-hours timezone
                  <input
                    name="timezone"
                    required
                    defaultValue={details?.timezone ?? launch.timezone}
                  />
                </label>
                <fieldset>
                  <legend>Permitted weekly meeting hours</legend>
                  <p>
                    Use staffed or otherwise permitted meeting hours. For overnight opening, enter
                    separate days.
                  </p>
                  {days.map((day, i) => {
                    const h = details?.hours.find((w) => w.day === i);
                    return (
                      <div className="hours-row" key={day}>
                        <label className="check">
                          <input name={`day-${i}`} type="checkbox" defaultChecked={!!h} />
                          {day}
                        </label>
                        <label>
                          {day} opens
                          <input
                            type="time"
                            name={`start-${i}`}
                            defaultValue={h ? timeOf(h.start) : '09:00'}
                          />
                        </label>
                        <label>
                          {day} closes
                          <input
                            type="time"
                            name={`end-${i}`}
                            defaultValue={h ? timeOf(h.end) : '17:00'}
                          />
                        </label>
                      </div>
                    );
                  })}
                </fieldset>
                <fieldset>
                  <legend>Verified accessibility</legend>
                  {accessFeatures.map((v) => (
                    <label className="check" key={v}>
                      <input
                        type="checkbox"
                        name={`access-${v}`}
                        defaultChecked={details?.accessibility[v] ?? false}
                      />
                      Verified accessible {v}
                    </label>
                  ))}
                  <label>
                    Accessibility details and limits
                    <textarea
                      name="access-details"
                      required
                      maxLength={1000}
                      defaultValue={details?.accessibility.details ?? ''}
                    />
                  </label>
                </fieldset>
                <label>
                  Cost band
                  <select name="costBand" defaultValue={details?.costBand ?? 0}>
                    {['Free', 'Low cost', 'Moderate cost', 'Higher cost'].map((c, i) => (
                      <option key={c} value={i}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                {flags.map(([key, label]) => (
                  <label className="check" key={key}>
                    <input name={key} type="checkbox" defaultChecked={details?.[key] ?? false} />
                    {label}
                  </label>
                ))}
                <label className="check">
                  <input
                    name="alcoholPrimary"
                    type="checkbox"
                    defaultChecked={selected?.alcoholPrimary ?? false}
                  />
                  Alcohol-primary venue (requires staffing and non-drinking alternatives; excluded
                  for under-21 members)
                </label>
                <fieldset>
                  <legend>Permitted activities</legend>
                  {activities.map((v) => (
                    <label className="check" key={v}>
                      <input
                        name="activity"
                        type="checkbox"
                        value={v}
                        defaultChecked={details?.activities.includes(v) ?? false}
                      />
                      {v}
                    </label>
                  ))}
                </fieldset>
                <fieldset>
                  <legend>Private operational records</legend>
                  <label className="check">
                    <input
                      name="partnered"
                      type="checkbox"
                      defaultChecked={selected?.partnered ?? false}
                    />
                    Partner venue
                  </label>
                  {privateText.map(([key, label, max]) => (
                    <label key={key}>
                      {label}
                      <textarea name={key} maxLength={max} defaultValue={selected?.[key] ?? ''} />
                    </label>
                  ))}
                  <p>
                    Keep member reports and identities in the safety console. These fields are
                    available only to assigned operators and administrators; access is audited.
                  </p>
                </fieldset>
                <label>
                  Review date
                  <input
                    name="reviewDate"
                    type="date"
                    required
                    defaultValue={details?.reviewDate ?? ''}
                  />
                </label>
                <label>
                  Review expiry date (end of day UTC)
                  <input
                    name="reviewExpiresAt"
                    type="date"
                    required
                    defaultValue={selected?.reviewExpiresAt.slice(0, 10) ?? ''}
                  />
                </label>
                <label className="check">
                  <input name="humanReviewed" type="checkbox" />I reviewed the public meeting area,
                  its access conditions and the checks above
                </label>
                <label className="check">
                  <input
                    name="approved"
                    type="checkbox"
                    defaultChecked={selected?.approved ?? false}
                  />
                  Approve for suggestions
                </label>
                <p>
                  Any venue change invalidates affected plans. Members must choose a current option
                  and both confirm again. A safety switch remains in effect until a safety reviewer
                  lifts it.
                </p>
                <div className="actions">
                  <button disabled={busy}>Save venue review</button>
                  <button type="button" className="secondary" onClick={() => setEditing(false)}>
                    Cancel review
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </section>
    </Shell>
  );
}
