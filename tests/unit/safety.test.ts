import { it, expect } from 'vitest';
import fc from 'fast-check';
import {
  isDenied,
  type PairMember,
  orderedPair,
  reportSchema,
} from '../../packages/core/src/safety';
import { helpResources } from '../../packages/config/src/safety';
it('I-04 deny policy is symmetric and authoritative for every blocked pair', () => {
  fc.assert(
    fc.property(fc.uuid(), fc.uuid(), fc.boolean(), (a, b, blocked) => {
      const u: PairMember = {
        id: a,
        state: 'ACTIVE',
        deleted: false,
        restricted: false,
        blocksOther: blocked,
      };
      const v: PairMember = { ...u, id: b, blocksOther: false };
      expect(isDenied(u, v)).toBe(isDenied(v, u));
      if (blocked) expect(isDenied(u, v)).toBe(true);
      expect(orderedPair(a, b)).toEqual(orderedPair(b, a));
      for (const change of [{ deleted: true }, { restricted: true }, { state: 'EXITED' as const }])
        expect(isDenied({ ...u, ...change }, v)).toBe(true);
    }),
  );
});
it('I-11 help needs no login or report and optional detail is truly optional', () => {
  expect(reportSchema.parse({ subjectId: null, context: { surface: 'settings' } }).detail).toBe('');
  expect(helpResources['US-NYC']!.resources.flatMap((r) => r.links).map((r) => r.href)).toContain(
    'tel:911',
  );
  expect(
    helpResources['US-NYC']!.resources.some((r) => r.name === '988 Suicide & Crisis Lifeline'),
  ).toBe(true);
});
