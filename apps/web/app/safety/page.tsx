import { Shell } from '../../components/shell';
import Link from 'next/link';
export default function Page() {
  return (
    <Shell>
      <section className="reading">
        <p className="eyebrow">SAFETY & CHOICE</p>
        <h1>
          Your comfort
          <br />
          <em>comes first.</em>
        </h1>
        <p className="lede">You decide who to meet, whether to continue, and when to leave.</p>
        <h2>Boundaries stay binding</h2>
        <p>
          Only you can change an explicit boundary. We do not infer your identity or relax a
          boundary because of your behavior. Nearby discovery is off in this preview, and no GPS is
          collected.
        </p>
        <h2>Photos are reviewed before discovery</h2>
        <p>
          Uploaded photos remain private while they wait for moderation. Photo approval is a content
          check. It is not identity verification or a guarantee about a person.
        </p>
        <h2>Approved public meeting places</h2>
        <p>
          The planned service will use reviewed public places. A public place cannot guarantee
          safety. You will be able to ask questions before traveling and cancel without explaining
          why.
        </p>
        <h2>Before live introductions</h2>
        <p>
          Independent blocking, “Something felt off” reporting, case status and appeals are
          available for synthetic testing. Human safety coverage and complete deletion processing
          must be ready before enrollment opens. This development preview is not monitored for
          emergencies.
        </p>
        <div className="actions">
          <Link className="button" href="/safety/help">
            Get help now
          </Link>
          <Link className="button secondary" href="/safety/concern">
            Something felt off
          </Link>
        </div>
        <div className="notice">
          Meetwell is not an emergency service. If you are in immediate danger, contact your local
          emergency services.
        </div>
      </section>
    </Shell>
  );
}
