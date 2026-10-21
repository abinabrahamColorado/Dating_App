import { Shell } from '../../components/shell';
import { accountConfig as c } from '@meetwell/config/accounts';
import { pilot } from '@meetwell/config/pilot';
export default function Page() {
  return (
    <Shell>
      <section className="reading">
        <p className="eyebrow">PRIVACY</p>
        <h1>
          A little information.
          <br />
          <em>A clear purpose.</em>
        </h1>
        <p className="lede">Development notice · {c.PRIVACY_VERSION}</p>
        <p>
          This preview is for synthetic accounts. It is not open for live enrollment. A reviewed
          production privacy notice and operational contacts are required before launch.
        </p>
        <h2>Account and profile</h2>
        <p>
          Email supports sign-in. Your birth date is encrypted in a separate identity store; your
          profile shows your age. Your chosen name, photos, prompt, interests and stated preferences
          support your profile and future introductions. Who-to-meet settings are private to your
          account and eligibility processing.
        </p>
        <h2>Area, photos and access</h2>
        <p>
          You select a broad area. We do not collect GPS, location history, contacts or camera-roll
          access. Photo metadata is removed, and encrypted photos are stored privately. Authorized
          moderators can review pending photos; staff access is recorded in an audit log.
        </p>
        <h2>Your controls</h2>
        <p>
          You can edit preferences and review their history, sign out other devices, pause, focus,
          or exit. A deletion request disables your account immediately. Full deletion processing is
          being built in a later milestone, so use synthetic data only.
        </p>
        <h2>Retention and limits</h2>
        <p>
          The planned active-store deletion maximum is {pilot.DELETION_ACTIVE_STORES_DAYS} days,
          with bounded backup expiry and separately reviewed safety holds. These are engineering
          targets for the future service, not a claim that deletion orchestration is complete in
          this preview. No matching model, marketing analytics or third-party tracking is enabled.
        </p>
      </section>
    </Shell>
  );
}
