import type { Profile, Preferences, Policy } from '../../packages/core/src/accounts';
export const syntheticProfile: Profile = {
  displayName: 'Synthetic Finch',
  gender: 'nonbinary',
  intention: 'long-term',
  structure: 'monogamous',
  areaId: 'chelsea',
  travelMinutes: 30,
  transport: 'transit',
  interests: ['Art', 'Books', 'Cooking', 'Coffee', 'Film'],
  prompt: 'A quiet page and a warm cup.',
  smoking: 'no',
  availability: { flexible: true, windows: [] },
};
export const syntheticPreferences: Preferences = {
  whoToMeet: ['woman', 'man', 'nonbinary'],
  age: { setting: 'HARD', min: 18, max: 30 },
  intention: { setting: 'HARD', values: ['long-term'] },
  structure: { setting: 'HARD', values: ['monogamous'] },
  smoking: { setting: 'HARD', values: ['no'] },
};
export const initialPolicy: Policy = {
  state: 'ONBOARDING',
  intent: 'EXPLORE',
  nearby: 'GHOST',
  version: 0,
  epoch: 0,
  pauseChat: false,
  planReminders: false,
  deletionRequested: false,
};
