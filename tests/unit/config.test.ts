import { describe, it, expect } from 'vitest';
import { pilot, retention, features, launch } from '../../packages/config/src/pilot';
describe('M0 configuration contract', () => {
  it('keeps event and Go capabilities disabled (Spec P23)', () => {
    expect(Object.values(features)).toEqual([false, false, false]);
  });
  it('retains the selected adult catchment and distinct public areas (Spec P4)', () => {
    expect(launch.minimumAge).toBe(18);
    expect(launch.maximumAge).toBe(30);
    expect(new Set(launch.areas.map((a) => a.id)).size).toBe(8);
  });
  it('bounds authority and retention independently (Spec P8, P22)', () => {
    expect(pilot.PRESENCE_LEASE_SECONDS).toBeLessThan(pilot.GO_SESSION_MINUTES * 60);
    expect(retention.D3_LOCATION_HISTORY_COLLECTION_ENABLED).toBe(false);
    expect(retention.D4_SETTING_DELETION_DAYS).toBe(pilot.DELETION_ACTIVE_STORES_DAYS);
  });
});
