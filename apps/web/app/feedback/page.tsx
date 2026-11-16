'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Feedback } from '@meetwell/core/feedback';
import { offeredChips } from '@meetwell/core/feedback';
import { Shell } from '../../components/shell';
import { api, Notice, messageOf } from '../../components/client';
import { SafetyLink, useSafetyCommand } from '../../components/safety';
type Card = {
  id: string;
  connectionId: string;
  subjectId: string;
  plannedAt: string;
  presented: boolean;
  dismissed: boolean;
  answer: Feedback | null;
};
function Questions({ card }: { card: Card }) {
  const [met, setMet] = useState<Feedback['met']>(null),
    [again, setAgain] = useState<Feedback['again']>(null),
    [chips, setChips] = useState<Feedback['chips']>([]);
  const [done, setDone] = useState(!!card.answer || card.dismissed),
    [status, setStatus] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const command = useSafetyCommand();
  useEffect(() => {
    if (!card.presented && !card.answer && !card.dismissed)
      void command(`feedback/${card.id}/present`, { dismiss: false }).catch((e) =>
        setError(messageOf(e)),
      );
  }, [card, command]);
  async function run(task: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError('');
    try {
      await task();
      setStatus(message);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="panel form-stack">
      <h2>Meeting planned for {new Date(card.plannedAt).toLocaleDateString()}</h2>
      <Notice error={error} status={status} />
      {!done ? (
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await command(`feedback/${card.id}/answer`, {
                met,
                again: met === 'YES' ? again : null,
                chips: met === 'YES' ? chips : [],
              });
              setDone(true);
            }, 'Your private answer is saved. Nothing was sent to the other person.');
          }}
        >
          <fieldset>
            <legend>Did you meet?</legend>
            {(
              [
                ['YES', 'Yes'],
                ['NO', 'No'],
                ['PREFER_NOT_TO_SAY', 'Prefer not to say'],
              ] as const
            ).map(([value, label]) => (
              <label className="check-row" key={value}>
                <input
                  type="radio"
                  name={`met-${card.id}`}
                  checked={met === value}
                  onChange={() => {
                    setMet(value);
                    setAgain(null);
                    setChips([]);
                  }}
                />
                {label}
              </label>
            ))}
          </fieldset>
          {met === 'YES' && (
            <fieldset>
              <legend>Would you like to see them again?</legend>
              {(
                [
                  ['YES', 'Yes'],
                  ['NOT_SURE', 'Not sure'],
                  ['NO', 'No'],
                  ['SKIP', 'Skip'],
                ] as const
              ).map(([value, label]) => (
                <label className="check-row" key={value}>
                  <input
                    type="radio"
                    name={`again-${card.id}`}
                    checked={again === value}
                    onChange={() => {
                      setAgain(value);
                      setChips([]);
                    }}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          )}
          {met === 'YES' && offeredChips(again).length > 0 && (
            <fieldset>
              <legend>Anything you would like to add? (optional)</legend>
              {offeredChips(again).map((chip) => (
                <label className="check-row" key={chip}>
                  <input
                    type="checkbox"
                    checked={chips.includes(chip)}
                    onChange={(e) =>
                      setChips(
                        e.target.checked ? [...chips, chip] : chips.filter((x) => x !== chip),
                      )
                    }
                  />
                  {chip}
                </label>
              ))}
            </fieldset>
          )}
          <button disabled={busy || met === null}>Save privately</button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await command(`feedback/${card.id}/present`, { dismiss: true });
                setDone(true);
              }, 'Skipped. You can keep using the service.')
            }
          >
            Skip these questions
          </button>
        </form>
      ) : (
        <p>{card.answer ? 'You saved a private answer.' : 'No more questions for this meeting.'}</p>
      )}
      <div className="actions">
        <button
          className="secondary"
          disabled={busy}
          onClick={() =>
            void run(
              () => command(`feedback/${card.connectionId}/invite`, {}),
              'Your invitation is queued in the connection chat.',
            )
          }
        >
          Invite to meet again
        </button>
        <Link href={`/connections/${card.connectionId}`}>Open connection</Link>
      </div>
      <details>
        <summary>We met again (optional)</summary>
        <p>This private report does not contact the other person.</p>
        <button
          disabled={busy}
          onClick={() =>
            void run(
              () => command(`feedback/${card.connectionId}/second-meeting`, { metAgain: true }),
              'Your private report is saved.',
            )
          }
        >
          Record a second meeting
        </button>
      </details>
      <SafetyLink subjectId={card.subjectId} surface="post-meeting" />
      <Link href={`/safety/concern?subject=${card.subjectId}&surface=post-meeting#integrity`}>
        Something important differed from their profile
      </Link>
    </article>
  );
}
export default function Page() {
  const [cards, setCards] = useState<Card[] | null>(null),
    [history, setHistory] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    void api<Card[]>('feedback')
      .then(setCards)
      .catch((e) => setError(messageOf(e)));
  }, []);
  const visible = cards?.filter((c) => history || (!c.presented && !c.dismissed && !c.answer));
  return (
    <Shell member>
      <section className="dashboard form-stack">
        <p className="eyebrow">AFTER A MEETING</p>
        <h1>A moment to reflect.</h1>
        <p>
          These questions are optional and private. Answers never unlock introductions, and neither
          person sees the other’s answers. An invitation is always a separate choice.
        </p>
        <Notice error={error} />
        {cards === null ? (
          <p role="status">Loading your meetings…</p>
        ) : (
          <>
            {!visible?.length && <p>No new questions. There is nothing you need to do.</p>}
            <button className="secondary" onClick={() => setHistory(!history)}>
              {history ? 'Hide previous meetings' : 'Review previous meetings'}
            </button>
            {visible?.map((c) => (
              <Questions key={c.id} card={c} />
            ))}
          </>
        )}
        <Link href="/outcomes">Follow-up choices</Link>
        <SafetyLink surface="post-meeting" />
      </section>
    </Shell>
  );
}
