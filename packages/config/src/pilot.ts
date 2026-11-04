/** M0 pilot hypotheses, not validated thresholds or legal safe harbors.
 * Spec references identify origin; M0 additions are explicitly marked.
 * Public area centroids are static reference geography, never member locations (DEC-002).
 */
export const launch = {
  name: 'Meetwell',
  nameStatus: 'working name',
  catchment: 'Manhattan, New York City',
  timezone: 'America/New_York',
  minimumAge: 18,
  maximumAge: 30,
  areas: [
    { id: 'lower-east-side', name: 'Lower East Side', centroid: [40.718, -73.987] },
    { id: 'east-village', name: 'East Village', centroid: [40.727, -73.982] },
    { id: 'greenwich-village', name: 'Greenwich Village', centroid: [40.733, -74.002] },
    { id: 'chelsea', name: 'Chelsea', centroid: [40.746, -74.001] },
    { id: 'midtown', name: 'Midtown', centroid: [40.754, -73.984] },
    { id: 'upper-west-side', name: 'Upper West Side', centroid: [40.786, -73.976] },
    { id: 'upper-east-side', name: 'Upper East Side', centroid: [40.773, -73.956] },
    { id: 'harlem', name: 'Harlem', centroid: [40.811, -73.946] },
  ],
} as const;
export const pilot = {
  MAX_ACTIVE_CONNECTIONS: 3, // Spec P6, P16; members may choose a lower cap.
  MAX_NEW_INTROS_PER_WEEK: 3, // Spec P6; delivered exposures, not successful matches.
  EXPLORE_RESPONSE_HOURS: 48, // Spec P6; expiry is UNKNOWN, not pass.
  ARCHIVE_SUGGEST_DAYS: 7, // Spec P6; suggestion only.
  EXPLORATION_EPSILON: 0.1, // Spec P14; conditional feasible-edge randomization, P13.
  GO_SESSION_MINUTES: 30, // Spec P7.
  GO_OFFER_LEASE_MINUTES: 5, // Spec P7.
  GO_MAX_NEW_PERSON_OFFERS_PER_SESSION: 2, // Spec P7.
  GO_RENEWALS_PER_HOUR: 2, // Spec P7; toggling never resets budget.
  GO_CONCURRENT_OFFERS: 1, // Spec P7.
  GO_CONCURRENT_SESSIONS_PER_MEMBER: 1, // Spec P22.
  PRESENCE_LEASE_SECONDS: 90, // Spec P8, P22 D2; event authority lease, no GPS.
  REVOCATION_ACK_P99_SECONDS: 2, // Spec P8, service objective only.
  AVAILABILITY_HORIZON_DAYS: 10, // M0/M3; Spec P6 flexible windows replace mandatory two hours.
  VENUE_IMBALANCE_LAMBDA: 0.5, // M0/M4; Spec P18 weight hypothesis.
  VENUE_SUGGESTIONS: 3, // M0/M4; Spec P18 stable short list.
  RETRIEVAL_MAX_ELIGIBLE_NEIGHBORS: 200, // Spec P10 upper pilot bound; exhaustive at small scale.
  STRONG_PREFERENCE_WEIGHT: 2, // M3 definition; Spec P11, P15.
  SOFT_PREFERENCE_WEIGHT: 1, // M3 definition; Spec P11, P15.
  WAIT_PRIORITY_BUCKET_DAYS: 7, // M3 weekly wait-time buckets; Spec P16.
  EXPLORE_RESERVATION_HOURS: 24, // M3/P6 soft hold before human approval; pilot hypothesis.
  EXPLORE_REMINDER_HOURS: 12, // M3/P6 one quiet reminder only after explicit opt-in.
  EXPLORE_WORK_BATCH_SIZE: 20, // M3 bounded worker sweep, P22.
  EXPLORE_MAX_REVIEW_MEMBERS: 200, // M3 exhaustive pilot graph; refuse larger snapshots, never silently truncate.
  EXPLORE_REQUESTS_PER_MINUTE: 30, // M3 discovery/decision abuse budget, P21.
  EXPLORE_MAIL_RETRY_SECONDS: 60, // M3 retry only when transport proves it did not send.
  EXPLORE_MAIL_MAX_ATTEMPTS: 5, // P22 durable bounded delivery; uncertain SMTP is held for review.
  EXPLORE_MAIL_UNCERTAIN_MINUTES: 5, // M3/P22 process loss after claiming a send requires review.
  TRAVEL_ESTIMATE_KMH: { walk: 4.5, bike: 12, transit: 15, drive: 12 }, // M3/P6 centroid estimates, not routing.
  TRAVEL_ESTIMATE_DETOUR_FACTOR: 1.3, // M3/P6 conservative pilot estimate; never member coordinates.
  EXACT_BENCHMARK_MAX_EDGES: 20, // P16 offline exhaustive solver bound.
  ONBOARDING_TARGET_SECONDS: 180, // M1 stricter target within Spec P4's 2–5 minutes.
  PROFILE_MIN_PHOTOS: 2,
  PROFILE_MAX_PHOTOS: 3, // Spec P4.
  ONBOARDING_MIN_INTERESTS: 5,
  ONBOARDING_MAX_INTERESTS: 8, // M1; Spec P4.
  FEEDBACK_MAX_CHIPS: 2, // Spec P17.
  FEEDBACK_LOCAL_HOUR: 10, // M5 morning after; protective explicit schedule, DEC-010, Spec P17.
  FOCUS_OFFER_AFTER_CONFIRMED_PLANS: 2, // M4; Spec P5 opt-in.
  ALCOHOL_PRIMARY_VENUE_MIN_AGE: 21, // Founder instruction; Spec P18, product restriction.
  FOLLOWUP_DAYS: [30, 90], // Spec P13, P17; separate opt-in.
  OUTCOME_HORIZON_DAYS: 28,
  METRIC_RATE_DENOMINATOR: 100, // Spec P26 fixed cohort.
  COVERAGE_HORIZON_DAYS: 14, // Spec P23, P26.
  COVERAGE_GATE: 0.8,
  FOLLOW_THROUGH_GATE: 0.6, // Spec P23.
  GO_INCREMENTAL_MEETINGS_PER_100: 5, // Spec P23 over OUTCOME_HORIZON_DAYS.
  SMALL_CELL_MIN_MEMBERS: 10, // M0 protective hypothesis; Spec P16, P26 do not prescribe size.
  NONURGENT_ACK_HOURS: 24, // Spec P20; requires staffed operating promise.
  CONCIERGE_MIN_ADULTS: 50,
  CONCIERGE_MAX_ADULTS: 100, // Spec P23, P32.
  INITIAL_VENUE_REVIEW_MIN: 10,
  INITIAL_VENUE_REVIEW_MAX: 20, // Spec P32.
  BACKUP_EXPIRY_DAYS: 30,
  DELETION_ACTIVE_STORES_DAYS: 30, // Spec P22.
} as const;
export const retention = {
  D1_RAW_GPS_COLLECTION_ENABLED: false, // Spec P22 D1; event-only scope, never collected.
  D1_LATER_PROCESSING_DEADLINE_SECONDS: 10, // Spec P22 D1; dormant reference, not implemented.
  D2_EVENT_AUTHORITY_LEASE_SECONDS: pilot.PRESENCE_LEASE_SECONDS, // Spec P22 D2.
  D2_SESSION_METADATA_HOURS: 24, // Spec P22 D2; no location.
  D3_LOCATION_HISTORY_COLLECTION_ENABLED: false, // Spec P22 D3.
  D4_SETTING_DELETION_DAYS: pilot.DELETION_ACTIVE_STORES_DAYS, // Spec P22 D4.
  D5_INACTIVE_REVIEW_DAYS: 90,
  D5_TRAINING_ROWS_DAYS: 180, // Spec P22 D5; rows only, no model in MVP.
  D6_APPEARANCE_COLLECTION_ENABLED: false, // Spec P22 D6; no embeddings.
  D6_LATER_DELETION_DAYS: pilot.DELETION_ACTIVE_STORES_DAYS, // Spec P22 D6; dormant reference.
  D7_SETTING_DELETION_DAYS: pilot.DELETION_ACTIVE_STORES_DAYS, // Spec P22 D7.
  D8_IDENTIFIABLE_FEEDBACK_DAYS: 180, // Spec P22 D8; delete or risk-reviewed aggregate.
  D9_SAFETY_AFTER_CLOSURE_MONTHS: 24,
  D9_REVIEW_MONTHS: 12, // Spec P22 D9; calendar months, scoped holds.
  D10_RAW_VENDOR_EVIDENCE_HOURS: 24, // Spec P22 D10; external vendor contract target, no raw evidence here.
  D11_CHAT_AFTER_CLOSURE_DAYS: 90, // Spec P22 D11; reported copy isolated in safety.
  D11_ACTIVE_STORE_DELETION_DAYS: pilot.DELETION_ACTIVE_STORES_DAYS, // Spec P22 D11.
  D12_PLAN_AFTER_CLOSURE_DAYS: 90, // Spec P22 D12; remove member linkage.
  D13_RAW_SECURITY_LOG_DAYS: 7,
  D13_MINIMIZED_COUNTER_DAYS: 30, // Spec P22 D13, DEC-005.
  D14_RESEARCH_CONSENT_REVIEW_DAYS: 180, // Spec P22 D14; collection deferred.
  D15_CONTACT_IMPORT_ENABLED: false, // Spec P22 D15; direct blocks only.
  AUDIT_REVIEW_DAYS: 90, // M0 explicit minimization review; Spec P22 / DEC-013.
} as const;
export const features = {
  EVENTS_ENABLED: false,
  GO_ENABLED: false,
  NEW_PERSON_GO_ENABLED: false,
} as const;
