import { launch } from '@meetwell/config/pilot';
export default function ScaffoldPage() {
  return (
    <main>
      <p className="label">M0 · ENGINEERING SCAFFOLD</p>
      <h1>{launch.name}</h1>
      <p>The project foundation is running.</p>
      <p>Member accounts, introductions, and operations tools arrive in later milestones.</p>
      <a href="/api/v1/health">Check process health</a>
    </main>
  );
}
