'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { ConnectionStore } from '@meetwell/db/connections';
import {
  activities,
  accessFeatures,
  localMeetingInstant,
  zonedParts,
  type PublicVenue,
} from '@meetwell/core/connections';
import { launch, pilot } from '@meetwell/config/pilot';
import { api, messageOf, Notice, type Me } from './client';
import { SafetyLink, useSafetyCommand } from './safety';
import { Shell } from './shell';
type View = Awaited<ReturnType<ConnectionStore['view']>>;
type Open = Extract<View, { status: 'OPEN' }>;
type Options = Awaited<ReturnType<ConnectionStore['options']>>;
type Plan = Open['plans'][number];
const activityLabels = {
  conversation: 'Conversation',
  coffee: 'Coffee or tea',
  walk: 'A public walk',
  meal: 'A meal',
};
const costs = ['Free', 'Low cost', 'Moderate cost', 'Higher cost'];
function when(start: string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: launch.timezone,
  }).format(new Date(start));
}
function localValue(instant: string) {
  const p = zonedParts(new Date(instant), launch.timezone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}T${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}
export function VenueCard({ venue: v }: { venue: PublicVenue }) {
  return (
    <div className="venue-details">
      <h3>{v.name}</h3>
      <p>{v.address}</p>
      <p>Entrance: {v.entrance}</p>
      <p>Meeting area: {v.permittedMeetingArea}</p>
      <p>
        {costs[v.costBand]} · {v.noPurchase ? 'No purchase required' : 'Purchase may be required'} ·{' '}
        {v.alcoholFree ? 'Alcohol-free options' : 'No verified alcohol-free option'}
      </p>
      <p>Accessibility: {v.accessibility.details}</p>
      <p>
        Verified:{' '}
        {accessFeatures.filter((f) => v.accessibility[f]).join(', ') ||
          'No accessibility features verified'}
        .
      </p>
      <p>
        {v.seating ? 'Seating available' : 'Seating not verified'} · Transit: {v.transit}
      </p>
      <p>Exit information: {v.emergencyExitNotes}</p>
      <p>Checks: {v.checks}</p>
      <p>
        Reviewed {v.reviewDate}; review expires {when(v.reviewExpiresAt)} ({launch.timezone}).
      </p>
      <details>
        <summary>Opening hours ({v.timezone})</summary>
        <ul>
          {v.hours.map((h, i) => (
            <li key={i}>
              {
                ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
                  h.day
                ]
              }
              : {String(Math.floor(h.start / 60)).padStart(2, '0')}:
              {String(h.start % 60).padStart(2, '0')}–
              {String(Math.floor(h.end / 60)).padStart(2, '0')}:
              {String(h.end % 60).padStart(2, '0')}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
export function ConnectionPage({ id, planId }: { id: string; planId?: string }) {
  const [data, setData] = useState<View | null>(null),
    [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false);
  const [older, setOlder] = useState<Open['messages']>([]),
    [earlier, setEarlier] = useState<string | null>(null),
    [loadedOlder, setLoadedOlder] = useState(false);
  const [text, setText] = useState(''),
    [options, setOptions] = useState<Options | null>(null),
    [time, setTime] = useState(''),
    [minutes, setMinutes] = useState<number>(pilot.PLAN_DEFAULT_MINUTES),
    [editing, setEditing] = useState<Plan | null>(null);
  const command = useSafetyCommand();
  const refresh = useCallback(async () => {
    try {
      const next = await api<View>(`connections/${id}${planId ? `?plan=${planId}` : ''}`);
      setData(next);
      if (next.status !== 'OPEN') {
        setOlder([]);
        setOptions(null);
        setText('');
      }
      setError('');
    } catch (e) {
      setData(null);
      setError(messageOf(e));
    }
  }, [id, planId]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, pilot.CHAT_POLL_MILLISECONDS);
    return () => clearInterval(timer);
  }, [refresh]);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  async function send(value: string) {
    await command(`connections/${id}/messages`, { text: value });
    setText('');
    setStatus('Message saved.');
  }
  async function planAction(p: Plan, action: 'CONFIRM' | 'CANCEL' | 'DECLINE') {
    await command(
      `connections/${id}/plans`,
      action === 'CONFIRM'
        ? { action, planId: p.id, revision: p.revision }
        : { action, planId: p.id, version: p.version },
    );
    setStatus(
      action === 'CONFIRM'
        ? 'Your confirmation is recorded.'
        : action === 'CANCEL'
          ? 'Plan cancelled.'
          : 'Plan declined.',
    );
  }
  async function share(p: Plan, firstName: string) {
    const current = await api<View>(`connections/${id}?plan=${p.id}`);
    if (current.status !== 'OPEN') throw new Error('This connection has ended.');
    const plan = current.plans.find(
      (v) => v.id === p.id && v.revision === p.revision && v.state === 'CONFIRMED',
    );
    if (!plan) throw new Error('The plan has changed. Review it together before sharing.');
    const value = `${firstName}\n${plan.venue.name}, ${plan.venue.address}\n${when(plan.time.start)} (${launch.timezone})`;
    if (typeof navigator.share === 'function') {
      await navigator.share({ text: value });
      setStatus('Plan shared.');
    } else {
      await navigator.clipboard.writeText(value);
      setStatus('Plan copied.');
    }
  }
  const messages =
    data?.status === 'OPEN'
      ? [...new Map([...older, ...data.messages].map((m) => [m.id, m])).values()].sort(
          (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
        )
      : [];
  return (
    <Shell member>
      <section className="dashboard">
        <p className="eyebrow">AT YOUR PACE</p>
        <h1>{planId ? 'Your meeting plan' : 'A conversation, and a next step.'}</h1>
        <p>
          <SafetyLink
            {...(data ? { subjectId: data.subjectId } : {})}
            surface={planId ? 'plan' : 'chat'}
          />
          {' · '}
          <Link href="/safety/help">Get help now</Link>
        </p>
        <Notice error={error} status={status} />
        {!data ? (
          <p>
            {error
              ? 'This connection is unavailable. You can still get help or report a concern.'
              : 'Loading your connection…'}
          </p>
        ) : data.status !== 'OPEN' ? (
          <>
            <p>
              {data.status === 'ENDED'
                ? 'This connection has ended.'
                : 'Chat and planning are currently unavailable.'}
            </p>
            {data.status === 'UNAVAILABLE' && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await command(`explore/${id}/close`, {});
                    setStatus('Connection closed. Your slot is available again.');
                  })
                }
              >
                Close connection privately
              </button>
            )}
            <Link href="/explore">Back to introductions</Link>
          </>
        ) : (
          <>
            <p>
              With {data.profile.displayName}.{' '}
              <Link href={`/members/${data.subjectId}`}>View profile</Link>
            </p>
            {planId && (
              <p>
                <Link href={`/connections/${id}`}>Back to chat and planning</Link>
              </p>
            )}
            {!planId && (
              <>
                <section className="panel form-stack" aria-labelledby="conversation-title">
                  <h2 id="conversation-title">Conversation</h2>
                  {data.archiveSuggested && (
                    <p className="notice">
                      There has not been recent progress here. You can archive this connection when
                      you are ready. There is no need to send a message.
                    </p>
                  )}
                  {(loadedOlder ? earlier : data.earlier) && (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          const page = await api<View>(
                            `connections/${id}?before=${loadedOlder ? earlier : data.earlier}`,
                          );
                          if (page.status === 'OPEN') {
                            setOlder((old) => [...page.messages, ...old]);
                            setEarlier(page.earlier);
                            setLoadedOlder(true);
                          }
                        })
                      }
                    >
                      Load earlier messages
                    </button>
                  )}
                  <ol className="chat-messages" aria-label="Messages">
                    {messages.map((m) => (
                      <li key={m.id}>
                        <strong>{m.own ? 'You' : data.profile.displayName}</strong>
                        <p>{m.text}</p>
                        <time dateTime={m.createdAt}>{when(m.createdAt)}</time>
                      </li>
                    ))}
                  </ol>
                  {!messages.length && (
                    <p>
                      You can ask a question or make a plan whenever you are ready. Messaging is
                      optional.
                    </p>
                  )}
                  <form
                    className="form-stack"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act(() => send(text));
                    }}
                  >
                    <label htmlFor="message">Your message</label>
                    <textarea
                      id="message"
                      maxLength={pilot.CHAT_MAX_CHARACTERS}
                      required
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                    />
                    <button disabled={busy || !text.trim()}>Send message</button>
                  </form>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await command(`explore/${id}/close`, {});
                        setStatus('Connection closed. Your slot is available again.');
                      })
                    }
                  >
                    {data.archiveSuggested
                      ? 'Archive connection privately'
                      : 'Close connection privately'}
                  </button>
                </section>
                <section className="panel form-stack">
                  <h2>What works for your meeting</h2>
                  <p>
                    These choices are private. Suggested places must work for both people. Changing
                    a choice invalidates future plans so you can both review them again.
                  </p>
                  <form
                    key={data.preferences.version}
                    className="form-stack"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void act(async () => {
                        await command(`connections/${id}/preferences`, {
                          version: data.preferences.version,
                          data: {
                            maxCostBand: Number(f.get('cost')),
                            accessibility: f.getAll('access'),
                            activities: f.getAll('activity'),
                            alcoholFree: f.has('alcoholFree'),
                            allowAlcoholPrimary: f.has('allowAlcoholPrimary'),
                            noPurchase: f.has('noPurchase'),
                          },
                        });
                        setOptions(null);
                        setStatus('Your meeting preferences are saved.');
                      });
                    }}
                  >
                    <label htmlFor="meeting-cost">Maximum cost</label>
                    <select
                      id="meeting-cost"
                      name="cost"
                      defaultValue={data.preferences.data.maxCostBand}
                    >
                      {costs.map((v, i) => (
                        <option key={i} value={i}>
                          {v}
                        </option>
                      ))}
                    </select>
                    <fieldset>
                      <legend>Required verified accessibility</legend>
                      {accessFeatures.map((v) => (
                        <label className="check" key={v}>
                          <input
                            type="checkbox"
                            name="access"
                            value={v}
                            defaultChecked={data.preferences.data.accessibility.includes(v)}
                          />
                          Accessible {v}
                        </label>
                      ))}
                    </fieldset>
                    <fieldset>
                      <legend>Activities you are open to</legend>
                      {activities.map((v) => (
                        <label className="check" key={v}>
                          <input
                            type="checkbox"
                            name="activity"
                            value={v}
                            defaultChecked={data.preferences.data.activities.includes(v)}
                          />
                          {activityLabels[v]}
                        </label>
                      ))}
                    </fieldset>
                    <label className="check">
                      <input
                        type="checkbox"
                        name="alcoholFree"
                        defaultChecked={data.preferences.data.alcoholFree}
                      />
                      Require alcohol-free options
                    </label>
                    <label className="check">
                      <input
                        type="checkbox"
                        name="noPurchase"
                        defaultChecked={data.preferences.data.noPurchase}
                      />
                      Require no-purchase options
                    </label>
                    <label className="check">
                      <input
                        type="checkbox"
                        name="allowAlcoholPrimary"
                        defaultChecked={data.preferences.data.allowAlcoholPrimary}
                      />
                      I am open to an alcohol-primary venue with a non-drinking alternative
                    </label>
                    <button disabled={busy}>Save meeting preferences</button>
                  </form>
                </section>
              </>
            )}
            <section className="panel form-stack" aria-labelledby="plans-title">
              <h2 id="plans-title">{planId ? 'Plan details' : 'Plans together'}</h2>
              {!data.plans.length && (
                <p>No plan yet. You can make one without sending a message.</p>
              )}
              {data.plans.map((p) => (
                <article className="plan-card" key={p.id}>
                  <h3>
                    {when(p.time.start)} ({launch.timezone}) · {p.time.minutes} minutes
                  </h3>
                  <p>
                    {
                      {
                        PROPOSED: 'Both people need to confirm this plan.',
                        CONFIRMED: 'You both confirmed this plan.',
                        DECLINED: 'This plan was declined.',
                        CANCELLED: 'This plan was cancelled.',
                        INVALIDATED:
                          'This plan has changed or is unavailable. Choose a current venue and time, then both confirm again.',
                      }[p.state]
                    }
                  </p>
                  <VenueCard venue={p.venue} />
                  {!planId && (
                    <p>
                      <Link href={`/connections/${id}/plans/${p.id}`}>Open plan page</Link>
                    </p>
                  )}
                  <div className="actions">
                    {['PROPOSED', 'CONFIRMED'].includes(p.state) && (
                      <>
                        {p.state === 'PROPOSED' && (
                          <button
                            disabled={busy || p.confirmedByYou}
                            onClick={() => void act(() => planAction(p, 'CONFIRM'))}
                          >
                            {p.confirmedByYou
                              ? 'Your confirmation is recorded'
                              : 'Confirm this venue and time'}
                          </button>
                        )}
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() => void act(() => planAction(p, 'DECLINE'))}
                        >
                          Decline plan
                        </button>
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() => void act(() => planAction(p, 'CANCEL'))}
                        >
                          Cancel plan
                        </button>
                      </>
                    )}
                    {['PROPOSED', 'CONFIRMED', 'INVALIDATED'].includes(p.state) && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => {
                          setEditing(p);
                          setOptions(null);
                          setTime(localValue(p.time.start));
                          setMinutes(p.time.minutes);
                          document.getElementById('propose-time')?.focus();
                        }}
                      >
                        Suggest another venue or time
                      </button>
                    )}
                    {p.state === 'CONFIRMED' && (
                      <>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void act(async () => {
                              const r = await api<{ ics: string }>(
                                `connections/${id}/plans/${p.id}/calendar`,
                              );
                              const url = URL.createObjectURL(
                                new Blob([r.ics], { type: 'text/calendar;charset=utf-8' }),
                              );
                              const link = document.createElement('a');
                              link.href = url;
                              link.download = 'meetwell-plan.ics';
                              link.click();
                              URL.revokeObjectURL(url);
                            })
                          }
                        >
                          Add to calendar
                        </button>
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() => void act(() => share(p, data.firstName))}
                        >
                          Share plan
                        </button>
                      </>
                    )}
                  </div>
                  {p.state === 'CONFIRMED' && (
                    <div className="actions" aria-label="Optional messages">
                      {["I'm here", 'Running late', 'I need to leave'].map((value) => (
                        <button
                          className="secondary"
                          disabled={busy}
                          key={value}
                          onClick={() => void act(() => send(value))}
                        >
                          {value}
                        </button>
                      ))}
                    </div>
                  )}
                </article>
              ))}
              <p>
                Approved public meeting places have been reviewed for the checks shown. They do not
                provide a guarantee of safety or supervision.
              </p>
            </section>
            {(!planId || editing) && (
              <section className="panel form-stack">
                <h2>{editing ? 'Suggest a change' : 'Make a plan'}</h2>
                {editing && (
                  <button
                    className="secondary"
                    onClick={() => {
                      setEditing(null);
                      setOptions(null);
                    }}
                  >
                    Leave this change
                  </button>
                )}
                <p>
                  {data.availability.flexible
                    ? 'You both chose flexible availability. Propose a time that works for you.'
                    : 'Choose a time within one of your shared availability windows.'}{' '}
                  Times are shown in {launch.timezone}.
                </p>
                {!data.availability.flexible && (
                  <ul>
                    {data.availability.windows.map((w, i) => (
                      <li key={i}>
                        {when(w.start)}–{when(w.end)}
                      </li>
                    ))}
                  </ul>
                )}
                <form
                  className="form-stack"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act(async () => {
                      const start = localMeetingInstant(time);
                      if (!start)
                        throw new Error(
                          'This local time is ambiguous or unavailable because of a clock change. Choose another time.',
                        );
                      setOptions(
                        await command<Options>(`connections/${id}/options`, { start, minutes }),
                      );
                    });
                  }}
                >
                  <label htmlFor="propose-time">Proposed date and time ({launch.timezone})</label>
                  <input
                    id="propose-time"
                    type="datetime-local"
                    required
                    value={time}
                    onChange={(e) => {
                      setTime(e.target.value);
                      setOptions(null);
                    }}
                  />
                  <label htmlFor="duration">Duration in minutes</label>
                  <input
                    id="duration"
                    type="number"
                    min={pilot.PLAN_MIN_MINUTES}
                    max={pilot.PLAN_MAX_MINUTES}
                    required
                    value={minutes}
                    onChange={(e) => {
                      setMinutes(Number(e.target.value));
                      setOptions(null);
                    }}
                  />
                  <button disabled={busy}>Find meeting places</button>
                </form>
                {options && (
                  <>
                    <h3>Approved public meeting places</h3>
                    <p>
                      The list stays stable for this time and your meeting preferences. Unavailable
                      places are removed.
                    </p>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          setOptions(
                            await command<Options>(`connections/${id}/options`, {
                              ...options.time,
                              refresh: crypto.randomUUID(),
                            }),
                          );
                        })
                      }
                    >
                      Refresh reviewed places
                    </button>
                    {!options.venues.length && (
                      <p>
                        No approved place currently fits both people’s choices and this time. You
                        can choose another time or change your own preferences.
                      </p>
                    )}
                    {options.venues.map((v) => (
                      <article className="plan-card" key={v.id}>
                        <VenueCard venue={v} />
                        <button
                          disabled={busy}
                          onClick={() =>
                            void act(async () => {
                              const r = await command<{ id: string }>(
                                `connections/${id}/plans`,
                                editing
                                  ? {
                                      action: 'CHANGE',
                                      planId: editing.id,
                                      version: editing.version,
                                      optionsId: options.id,
                                      venueId: v.id,
                                    }
                                  : { action: 'PROPOSE', optionsId: options.id, venueId: v.id },
                              );
                              setOptions(null);
                              setEditing(null);
                              setStatus(
                                'Plan proposed. Both people must confirm the same venue and time.',
                              );
                              if (planId && r.id !== planId)
                                window.location.assign(`/connections/${id}/plans/${r.id}`);
                            })
                          }
                        >
                          {editing ? `Suggest ${v.name}` : `Propose ${v.name}`}
                        </button>
                      </article>
                    ))}
                  </>
                )}
              </section>
            )}
            {data.focusOffer && (
              <section className="panel">
                <h2>Would you like to focus?</h2>
                <p>
                  You have confirmed two plans together. Focus pauses new introductions while
                  keeping existing connections. It is optional and has no public badge.
                </p>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const me = await api<Me>('me');
                      await command('account/policy', {
                        action: 'FOCUS',
                        version: me.policy.version,
                      });
                      setStatus('Focus is on. You can change it in settings.');
                    })
                  }
                >
                  Choose Focus
                </button>
              </section>
            )}
          </>
        )}
      </section>
    </Shell>
  );
}
