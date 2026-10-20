import { readFileSync } from 'node:fs';
import { it, expect } from 'vitest';
it('M0 trace maps each invariant and every numbered requirement uniquely', () => {
  const trace = readFileSync('docs/SPEC_TRACE.md', 'utf8');
  const rows = [...trace.matchAll(/^\| REQ-(\d+)\s+\|/gm)].map((m) => Number(m[1]));
  expect(rows).toHaveLength(193);
  expect(rows).toEqual(Array.from({ length: rows.length }, (_, i) => i + 1));
  for (let i = 1; i <= 20; i++)
    expect(trace).toMatch(new RegExp(`\\| I-${String(i).padStart(2, '0')}\\s+\\|`));
});
it('M0 architecture inventories every sensitive data class and every Spec P22 entity', () => {
  const doc = readFileSync('docs/ARCHITECTURE.md', 'utf8');
  for (let i = 1; i <= 15; i++) expect(doc).toMatch(new RegExp(`\\| D${i} `));
  for (const entity of [
    'User',
    'IdentityCheck',
    'ConsentRecord',
    'Profile',
    'Media',
    'ExplicitConstraint',
    'SoftPreference',
    'DiscoveryPolicy',
    'CapacityLedger',
    'Reservation',
    'LocationSession',
    'CurrentPresence',
    'GeospatialZone',
    'GeospatialCell',
    'CandidatePool',
    'PoolMembership',
    'CandidatePair',
    'Opportunity',
    'Recommendation',
    'Decision',
    'Conversation',
    'MeetNowIntent',
    'Rendezvous',
    'DatePlan',
    'Attendance',
    'PublicVenue',
    'VenueReview',
    'EventConsent',
    'EventCheckIn',
    'MatchingFeedback',
    'BehaviorSignal',
    'PreferenceModel',
    'AttractionModel',
    'ModelVersion',
    'ReliabilityEvent',
    'IntegritySignal',
    'ReviewOutcome',
    'SafetySignal',
    'Report',
    'Block',
    'Enforcement',
    'Appeal',
    'CaseAccessAudit',
    'SelectionPropensity',
    'ExperimentAssignment',
    'EventLog',
    'OutcomeObservation',
    'DeletionJob',
  ])
    expect(doc).toContain(entity);
});
