import { features } from './pilot';

/** Spec P17/P20/P22. Pilot bounds, not operational response promises. */
export const safetyConfig = {
  DETAIL_MAX: 4000,
  CASE_PAGE_SIZE: 30,
  REQUESTS_PER_HOUR: 30,
  DEFAULT_JURISDICTION: 'US-NYC',
  SUPPORT_NOTICE:
    'This development preview is not monitored for emergencies. Support hours must be confirmed before the pilot opens.',
  GO_DISABLED: !features.GO_ENABLED,
  NEW_PERSON_GO_DISABLED: !features.NEW_PERSON_GO_ENABLED,
} as const;
export const severityLevels = {
  URGENT: 'Possible immediate harm; prioritize human triage during staffed operations.',
  HIGH: 'Threats, coercion, or a serious ongoing concern.',
  STANDARD: 'A concern for review; detail is optional.',
} as const;
export type HelpResource = {
  name: string;
  description: string;
  links: { label: string; href: string }[];
  source: string;
  verified: boolean;
};
/** Verified 2026-10-21 using NYC emergency guidance and the US helpline connector.
 * Additional local resources require an explicit founder-verification entry. */
export const helpResources: Record<string, { name: string; resources: HelpResource[] }> = {
  'US-NYC': {
    name: 'New York City',
    resources: [
      {
        name: 'Emergency help',
        description: 'For an immediate emergency, call 911.',
        links: [{ label: 'Call 911', href: 'tel:911' }],
        source: 'https://www.nyc.gov/main/your-government/contact-nyc-government',
        verified: true,
      },
      {
        name: '988 Suicide & Crisis Lifeline',
        description: 'Support for suicidal crisis or emotional distress in the United States.',
        links: [
          { label: '988', href: 'tel:988?oai_link_source=model_response_hotline' },
          { label: 'Text 988', href: 'sms:988?oai_link_source=model_response_hotline' },
          {
            label: 'Online chat',
            href: 'https://988lifeline.org/chat/?oai_link_source=model_response_hotline',
          },
        ],
        source: 'https://988lifeline.org?oai_link_source=model_response_hotline',
        verified: true,
      },
    ],
  },
};
