import Link from 'next/link';
import { Shell } from '../../components/shell';
import { pilot } from '@meetwell/config/pilot';
export default function Page() {
  return (
    <Shell>
      <section className="reading">
        <p className="eyebrow">HOW IT WORKS</p>
        <h1>
          A few introductions.
          <br />
          <em>A clear next step.</em>
        </h1>
        <p className="lede">
          Meetwell is being built around mutually wanted meetings, at a pace you choose.
        </p>
        <h2>Say what matters to you</h2>
        <p>
          A chosen name, your age, a few interests, one prompt, and two or three current photos make
          up your profile. Choose who you want to meet and your boundaries. Pick a broad area and
          travel time; we do not ask for GPS.
        </p>
        <h2>Keep the choice mutual</h2>
        <p>
          The planned Explore service offers up to {pilot.MAX_NEW_INTROS_PER_WEEK} new introductions
          a week, when an eligible introduction is available. There is no guarantee of a weekly
          introduction. You see photos and context before choosing. A pass stays private.
        </p>
        <h2>Talk before you travel</h2>
        <p>
          After mutual acceptance, the planned meeting flow lets you talk and agree on a public
          venue and time. Either person can cancel without a reason.
        </p>
        <h2>Make space when you need it</h2>
        <p>
          Focus pauses new introductions. Pause gives you a break. Exit is always your choice, and
          feedback will be optional.
        </p>
        <div className="notice">
          This preview currently supports accounts, profiles and photo review. Introductions, chat
          and meeting plans are still being built.
        </div>
        <Link className="button" href="/apply">
          Get started <span aria-hidden="true">↗</span>
        </Link>
      </section>
    </Shell>
  );
}
