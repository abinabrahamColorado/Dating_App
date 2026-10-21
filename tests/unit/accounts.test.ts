import { expect, it } from 'vitest';
import fc from 'fast-check';
import {
  ageOn,
  localDate,
  boundariesAllow,
  transitionPolicy,
  discoveryPermission,
  profileSchema,
  preferencesSchema,
  type EligibilityMember,
  type Policy,
} from '../../packages/core/src/accounts';
import {
  syntheticProfile as profile,
  syntheticPreferences as preferences,
  initialPolicy,
} from '../fixtures/accounts';
import { Envelope } from '../../packages/db/src/encryption';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { sanitizePhoto } from '../../apps/web/server/media';

it('I-01 exact birthdays, leap dates and launch-local midnight control adult eligibility', () => {
  expect(ageOn('2008-10-21', '2026-10-20')).toBe(17);
  expect(ageOn('2008-10-20', '2026-10-20')).toBe(18);
  expect(ageOn('2000-02-29', '2026-02-28')).toBe(25);
  expect(ageOn('2000-02-29', '2026-03-01')).toBe(26);
  expect(ageOn('2000-02-30', '2026-10-20')).toBeNull();
  expect(ageOn('2030-01-01', '2026-10-20')).toBeNull();
  expect(localDate(new Date('2026-10-20T02:00:00Z'))).toBe('2026-10-19');
});
it('I-02 bilateral hard-boundary property never crosses either member’s explicit exclusion', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 15, max: 40 }),
      fc.integer({ min: 15, max: 40 }),
      fc.constantFrom('no', 'sometimes', 'yes', 'not-stated' as const),
      (ageA, ageB, smoking) => {
        const a: EligibilityMember = { age: ageA, profile, preferences };
        const b: EligibilityMember = { age: ageB, profile: { ...profile, smoking }, preferences };
        expect(boundariesAllow(a, b)).toBe(boundariesAllow(b, a));
        if (boundariesAllow(a, b)) {
          expect(ageA).toBeGreaterThanOrEqual(18);
          expect(ageA).toBeLessThanOrEqual(30);
          expect(ageB).toBeGreaterThanOrEqual(18);
          expect(ageB).toBeLessThanOrEqual(30);
          expect(smoking).toBe('no');
        }
      },
    ),
  );
  const a: EligibilityMember = { age: 25, profile, preferences };
  expect(boundariesAllow(a, { ...a, preferences: { ...preferences, whoToMeet: ['man'] } })).toBe(
    false,
  );
  expect(boundariesAllow(a, { ...a, profile: { ...profile, intention: 'casual' } })).toBe(false);
  expect(boundariesAllow(a, { ...a, profile: { ...profile, structure: 'non-monogamous' } })).toBe(
    false,
  );
  expect(
    boundariesAllow(
      { ...a, preferences: { ...preferences, smoking: { setting: 'STRONG', values: ['no'] } } },
      { ...a, profile: { ...profile, smoking: 'yes' } },
    ),
  ).toBe(true);
});
it('I-13 precedence property across state axes and capacity; Ghost permits ordinary Explore', () => {
  fc.assert(
    fc.property(
      fc.constantFrom('ONBOARDING', 'ACTIVE', 'PAUSED', 'EXITED', 'RESTRICTED'),
      fc.constantFrom('EXPLORE', 'FOCUS'),
      fc.integer({ min: 0, max: 5 }),
      fc.boolean(),
      (state, intent, slots, deletionRequested) => {
        const policy: Policy = { ...initialPolicy, state, intent, deletionRequested };
        const decision = discoveryPermission(
          policy,
          { eligible: true, profileComplete: true, approvedPhotos: 2 },
          slots,
          3,
        );
        expect(decision === 'EXPLORE').toBe(
          !deletionRequested && state === 'ACTIVE' && intent === 'EXPLORE' && slots < 3,
        );
      },
    ),
  );
});
it('I-13 readiness cannot activate minors, incomplete profiles, or unapproved media; pause resumes through checks', () => {
  const ready = { eligible: true, profileComplete: true, approvedPhotos: 2 };
  for (const bad of [
    { ...ready, eligible: false },
    { ...ready, profileComplete: false },
    { ...ready, approvedPhotos: 1 },
  ])
    expect(() => transitionPolicy(initialPolicy, { action: 'ACTIVATE', version: 0 }, bad)).toThrow(
      'NOT_READY',
    );
  const active = transitionPolicy(initialPolicy, { action: 'ACTIVATE', version: 0 }, ready);
  const paused = transitionPolicy(active, { action: 'PAUSE', version: 1, pauseChat: true }, ready);
  expect(paused.pauseChat).toBe(true);
  expect(transitionPolicy(paused, { action: 'RESUME', version: 2 }, ready)).toMatchObject({
    state: 'ACTIVE',
    intent: 'EXPLORE',
    nearby: 'GHOST',
    epoch: 3,
  });
  for (const state of ['EXITED', 'RESTRICTED'] as const)
    expect(() =>
      transitionPolicy({ ...initialPolicy, state }, { action: 'ACTIVATE', version: 0 }, ready),
    ).toThrow('ACCOUNT_DISABLED');
});
it('I-17 profile contracts reject precise location, DOB and unknown fields', () => {
  for (const extra of [
    { latitude: 40.7 },
    { birthDate: '2000-01-01' },
    { score: 0.8 },
    { longitude: -74 },
  ])
    expect(profileSchema.safeParse({ ...profile, ...extra }).success).toBe(false);
  expect(profileSchema.safeParse({ ...profile, areaId: 'unknown-area' }).success).toBe(false);
  expect(preferencesSchema.safeParse({ ...preferences, learned: true }).success).toBe(false);
});
it('REQ-159 envelope encryption has separate random data keys and rejects tamper or cross-record use', () => {
  const cipher = new Envelope(randomBytes(32).toString('base64'));
  const a = cipher.seal({ birth: 'synthetic-private' }, 'identity:a');
  const b = cipher.seal({ birth: 'synthetic-private' }, 'identity:a');
  expect(a).not.toBe(b);
  expect(a).not.toContain('synthetic-private');
  expect(cipher.open(a, 'identity:a')).toEqual({ birth: 'synthetic-private' });
  expect(() => cipher.open(a, 'identity:b')).toThrow();
  expect(() => new Envelope(randomBytes(32).toString('base64')).open(a, 'identity:a')).toThrow();
  const parts = a.split('.');
  const bytes = Buffer.from(parts[2]!, 'base64');
  bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
  parts[2] = bytes.toString('base64');
  expect(() => cipher.open(parts.join('.'), 'identity:a')).toThrow();
});
it('REQ-027 decoded photos lose EXIF/XMP and reject executable input', async () => {
  const input = await sharp({
    create: { width: 100, height: 100, channels: 3, background: '#a3b5a1' },
  })
    .withExif({
      IFD0: { Artist: 'Synthetic metadata', ImageDescription: 'Private synthetic location' },
    })
    .jpeg()
    .toBuffer();
  expect((await sharp(input).metadata()).exif).toBeDefined();
  const output = await sanitizePhoto(input);
  const meta = await sharp(output).metadata();
  expect(meta.exif).toBeUndefined();
  expect(meta.xmp).toBeUndefined();
  expect(meta.icc).toBeUndefined();
  expect(meta.format).toBe('jpeg');
  await expect(sanitizePhoto(Buffer.from('<svg><script>bad()</script></svg>'))).rejects.toThrow();
});
