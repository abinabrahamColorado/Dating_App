import { Shell } from '../../../components/shell';
import { helpResources, safetyConfig } from '@meetwell/config/safety';
import Link from 'next/link';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ jurisdiction?: string }>;
}) {
  const { jurisdiction } = await searchParams;
  const help = helpResources[jurisdiction ?? safetyConfig.DEFAULT_JURISDICTION];
  return (
    <Shell>
      <section className="dashboard form-stack">
        <p className="eyebrow">AT YOUR CHOICE</p>
        <h1>Get help now</h1>
        <p>{safetyConfig.SUPPORT_NOTICE}</p>
        {help ? (
          <>
            <h2>{help.name}</h2>
            {help.resources.map((r) => (
              <article className="panel" key={r.name}>
                <h3>{r.name}</h3>
                <p>{r.description}</p>
                {!r.verified && <p>Founder verification required before use.</p>}
                <div className="actions">
                  {r.links.map((l) => (
                    <a className="button secondary" key={l.href} href={l.href}>
                      {l.label}
                    </a>
                  ))}
                </div>
                <a href={r.source}>Resource information</a>
              </article>
            ))}
          </>
        ) : (
          <p>
            Resources for this jurisdiction have not been configured. Use your local emergency
            service if you are in immediate danger.
          </p>
        )}
        <Link href="/safety/concern">Something felt off</Link>
        <p>
          You do not need to sign in, describe anything, block or report to use these resources.
        </p>
      </section>
    </Shell>
  );
}
