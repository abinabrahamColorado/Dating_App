import { Shell } from '../../components/shell';
import { AuthForm } from '../../components/auth-form';
export default function Page() {
  return (
    <Shell>
      <section className="form-page">
        <p className="eyebrow">GET STARTED</p>
        <h1>
          A little about
          <br />
          <em>where you are.</em>
        </h1>
        <p>Our first catchment is Manhattan, for adults aged 18–30.</p>
        <div className="notice">
          Private development preview. Use synthetic information only. Live enrollment is not open.
        </div>
        <p>
          Before your profile can be used: verify your email, confirm your age and the notices, add
          a profile and preferences, and submit two or three photos for review. Optional
          availability can wait.
        </p>
        <AuthForm apply />
      </section>
    </Shell>
  );
}
