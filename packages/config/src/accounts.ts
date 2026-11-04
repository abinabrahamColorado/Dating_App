/** M1 pilot choices; Spec P4/P5/P11/P12/P22, DEC-024–028. */
export const accountConfig = {
  TERMS_VERSION: 'development-2026-10-20',
  PRIVACY_VERSION: 'development-2026-10-20',
  MAGIC_LINK_MINUTES: 15,
  SESSION_DAYS: 14,
  REAUTH_MINUTES: 10,
  PASSKEY_CHALLENGE_MINUTES: 5,
  AUTH_REQUESTS_PER_HOUR: 5,
  AUTH_GLOBAL_REQUESTS_PER_HOUR: 100,
  AUTH_OUTBOX_CRON: '* * * * *',
  // DEC-030: bounded per-message retries; expiry still controls token validity.
  AUTH_OUTBOX_BATCH_SIZE: 10,
  AUTH_OUTBOX_MAX_ATTEMPTS: 5,
  AUTH_OUTBOX_RETRY_SECONDS: 60,
  SMTP_CONNECTION_TIMEOUT_MS: 5000,
  SMTP_GREETING_TIMEOUT_MS: 5000,
  SMTP_SOCKET_TIMEOUT_MS: 10000,
  WRITE_REQUESTS_PER_MINUTE: 40,
  JSON_MAX_BYTES: 24_000,
  PHOTO_MAX_BYTES: 8_000_000,
  PHOTO_MAX_PIXELS: 24_000_000,
  PHOTO_MAX_EDGE: 1600,
  PHOTO_JPEG_QUALITY: 85,
  DISPLAY_NAME_MAX: 40,
  PROMPT_MAX: 280,
  MAX_TRAVEL_MINUTES: 120,
  MAX_WEEKLY_WINDOWS: 14,
  OPS_PAGE_SIZE: 25,
  SESSION_LIST_MAX: 50,
} as const;

export const genders = ['woman', 'man', 'nonbinary'] as const;
export const intentions = ['long-term', 'exploring', 'casual'] as const;
export const structures = ['monogamous', 'non-monogamous', 'exploring'] as const;
export const intentionLabels = {
  'long-term': 'A long-term relationship',
  exploring: 'Open to exploring',
  casual: 'Casual dating',
} as const satisfies Record<(typeof intentions)[number], string>;
export const structureLabels = {
  monogamous: 'Monogamous',
  'non-monogamous': 'Consensually non-monogamous',
  exploring: 'Open to exploring',
} as const satisfies Record<(typeof structures)[number], string>;
export const transportModes = ['walk', 'transit', 'bike', 'drive'] as const;
export const smokingValues = ['no', 'sometimes', 'yes', 'not-stated'] as const;
export const interests = [
  'Art',
  'Books',
  'Cooking',
  'Coffee',
  'Film',
  'Games',
  'Gardening',
  'Hiking',
  'Live music',
  'Museums',
  'Photography',
  'Running',
  'Theatre',
  'Volunteering',
  'Walking',
  'Writing',
] as const;
export const preferenceLabels = {
  HARD: 'Only introduce within this boundary',
  STRONG: 'Strong preference, open to others',
  NONE: 'No preference',
} as const;
