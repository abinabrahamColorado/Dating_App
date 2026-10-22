import type { ExploreMember, PairFacts, Venue } from '../../packages/core/src/explore';
import { syntheticProfile, syntheticPreferences } from './accounts';
export const exploreNow = new Date('2026-10-21T16:00:00Z');
export const syntheticVenue: Venue = {
  id: '00000000-0000-4000-8000-000000000010',
  centroid: [40.746, -74.001],
  approved: true,
  reviewExpiresAt: '2030-01-01T00:00:00Z',
  alcoholPrimary: false,
};
export function exploreMember(id: string, freeSlots = 3): ExploreMember {
  return {
    id,
    state: 'ACTIVE',
    intent: 'EXPLORE',
    deleted: false,
    restricted: false,
    age: 24,
    profile: structuredClone(syntheticProfile),
    preferences: structuredClone(syntheticPreferences),
    complete: true,
    approvedPhotos: 2,
    freeSlots,
    remainingWeekly: 3,
    lastOfferAt: null,
    joinedAt: '2026-10-01T00:00:00Z',
    profileVersion: 1,
    preferenceVersion: 1,
    policyVersion: 1,
  };
}
export function allPairs(members: readonly ExploreMember[]): PairFacts[] {
  return members.flatMap((u, i) =>
    members
      .slice(i + 1)
      .map((v) => ({ u: u.id, v: v.id, blockedBy: [], legacyDenied: false, hasHistory: false })),
  );
}
