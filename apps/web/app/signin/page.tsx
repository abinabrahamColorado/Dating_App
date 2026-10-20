import { Shell } from '../../components/shell';
import { AuthForm } from '../../components/auth-form';
export default function Page() {
  return (
    <Shell>
      <section className="form-page">
        <p className="eyebrow">WELCOME BACK</p>
        <h1>
          Make yourself
          <br />
          <em>at home.</em>
        </h1>
        <p>Use your email link or a passkey you have already added.</p>
        <AuthForm />
      </section>
    </Shell>
  );
}
