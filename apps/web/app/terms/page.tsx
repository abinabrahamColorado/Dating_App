import { Shell } from '../../components/shell';
import { accountConfig as c } from '@meetwell/config/accounts';
export default function Page() {
  return (
    <Shell>
      <section className="reading">
        <p className="eyebrow">DEVELOPMENT TERMS</p>
        <h1>
          A careful
          <br />
          <em>starting point.</em>
        </h1>
        <p>
          Version {c.TERMS_VERSION}. This preview is limited to synthetic adult accounts. Do not
          upload real personal information or arrange real meetings through it.
        </p>
        <p>
          The pilot is planned for adults aged 18–30 in the listed Manhattan areas. Profile
          statements must be made explicitly. Participation is voluntary; no introduction,
          relationship outcome or safety guarantee is promised.
        </p>
        <p>
          Photos are reviewed before discovery. Respect others’ consent and privacy. Live service
          terms, incident ownership and support contacts need review before public enrollment opens.
        </p>
      </section>
    </Shell>
  );
}
