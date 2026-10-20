import Link from 'next/link';
import { Shell } from './shell';
import { launch, pilot } from '@meetwell/config/pilot';
export default function Home() {
  return (
    <Shell>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">LOCAL INTRODUCTIONS, WITH INTENTION</p>
          <h1>
            Room for
            <br />
            something <em>real.</em>
          </h1>
          <p className="lede">
            A few thoughtful introductions. A chance to talk. A public place to meet, when you both
            feel ready.
          </p>
          <div className="actions">
            <Link className="button" href="/apply">
              Find your starting point <span aria-hidden="true">↗</span>
            </Link>
            <Link href="/how-it-works">Take a closer look</Link>
          </div>
          <p className="quiet">
            Planned pilot: {launch.catchment} · Ages {launch.minimumAge}–{launch.maximumAge}
          </p>
        </div>
        <div
          className="connection-art"
          role="img"
          aria-label="Two winding paths meeting at a shared table, an illustration of making room for a connection"
        >
          <div className="art-label">SOMETHING TO LOOK FORWARD TO</div>
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="meeting-table">
            <span className="cup cup-one" />
            <span className="cup cup-two" />
            <span className="flower" aria-hidden="true">
              ✳
            </span>
          </div>
          <div className="art-note">
            Two people.
            <br />
            <em>A shared next step.</em>
          </div>
          <div className="art-bottom">
            AT YOUR PACE <span aria-hidden="true">↗</span>
          </div>
        </div>
      </section>
      <section className="principles">
        <p>
          Less to keep up with.
          <br />
          <strong>More room to be yourself.</strong>
        </p>
        <p>
          Explore is designed for up to {pilot.MAX_NEW_INTROS_PER_WEEK} introductions a week when a
          mutually eligible introduction is available. Your boundaries always come first.
        </p>
        <p>No introduction is a promise. You can pass, pause, or leave whenever you choose.</p>
      </section>
      <section className="section">
        <div className="section-heading">
          <p className="eyebrow">A SMALLER, MORE HUMAN RHYTHM</p>
          <h2>
            From hello to
            <br />
            <em>let’s meet.</em>
          </h2>
        </div>
        <div className="steps-grid">
          {[
            [
              '01',
              'Start with you',
              'Share a little about yourself, the people you want to meet, and what works for your week.',
            ],
            [
              '02',
              'Choose, privately',
              'See enough to make an informed choice. An introduction moves forward only when you both accept.',
            ],
            [
              '03',
              'Make a real plan',
              'Talk first. Choose an approved public meeting place and a time that works for both of you.',
            ],
          ].map(([n, title, copy]) => (
            <article className="step-card" key={n}>
              <span className="step-number">{n}</span>
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="choice-band">
        <div>
          <p className="eyebrow">YOUR PACE. YOUR CHOICE.</p>
          <h2>
            Good connections
            <br />
            need room for “no.”
          </h2>
        </div>
        <div>
          <p>
            Your preferences stay yours. A pause needs no explanation. Nearby discovery is off.
            There is no score attached to you.
          </p>
          <Link href="/safety">
            Read about safety and choice <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </section>
      <aside className="preview-note">
        <strong>We’re building carefully.</strong> This is a private development preview using
        synthetic accounts. Public enrollment and introductions are not open yet.
      </aside>
    </Shell>
  );
}
