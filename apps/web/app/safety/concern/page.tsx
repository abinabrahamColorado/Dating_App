import { Shell } from '../../../components/shell';
import { ConcernForm } from '../../../components/safety';
import { safetyContextSchema } from '@meetwell/core/safety';
import { z } from 'zod';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ subject?: string; surface?: string }>;
}) {
  const q = await searchParams,
    id = z.uuid().safeParse(q.subject),
    context = safetyContextSchema.safeParse({ surface: q.surface ?? 'settings' });
  return (
    <Shell member>
      <section className="dashboard">
        <p className="eyebrow">YOUR CHOICE, AT YOUR PACE</p>
        <h1>Something felt off</h1>
        <ConcernForm
          subjectId={id.success ? id.data : null}
          surface={context.success ? context.data.surface : 'settings'}
        />
      </section>
    </Shell>
  );
}
