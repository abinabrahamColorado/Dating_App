import { it, expect } from 'vitest';
import fc from 'fast-check';
import { isSpecReference } from '../../packages/core/src/spec-reference';
it('M0 core: spec references cover exactly the 32 source parts', () => {
  fc.assert(
    fc.property(fc.integer(), (n) => {
      expect(isSpecReference(`Spec P${n}`)).toBe(n >= 1 && n <= 32);
    }),
  );
  expect(isSpecReference('Spec P01')).toBe(false);
  expect(isSpecReference('Spec P3; SQL')).toBe(false);
});
