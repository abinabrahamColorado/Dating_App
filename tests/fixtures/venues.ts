import { randomUUID } from 'node:crypto';
import type { VenueWrite, MeetingVenue } from '../../packages/core/src/connections';
export function syntheticVenue(id = randomUUID()): VenueWrite {
  return {
    id,
    version: 0,
    name: 'Synthetic Public Room',
    latitude: 40.746,
    longitude: -74.001,
    approved: true,
    humanReviewed: true,
    alcoholPrimary: false,
    reviewExpiresAt: new Date(Date.now() + 365 * 86400000).toISOString(),
    partnered: true,
    partnerContact: 'Synthetic partner only',
    trainingStatus: 'Synthetic training reviewed',
    complaintHistory: 'Synthetic operational fixture; no personal data',
    details: {
      address: 'Synthetic public meeting fixture',
      entrance: 'Synthetic marked public entrance',
      category: 'civic-space',
      permittedMeetingArea: 'Synthetic main room',
      timezone: 'America/New_York',
      hours: Array.from({ length: 7 }, (_, day) => ({ day, start: 0, end: 1440 })),
      liveSessionEligible: false,
      accessibility: {
        entrance: true,
        seating: true,
        toilets: true,
        details: 'Synthetic verified step-free access',
      },
      seating: true,
      noPurchase: true,
      costBand: 0,
      alcoholFree: true,
      staffed: true,
      activities: ['conversation', 'coffee', 'walk', 'meal'],
      transit: 'Synthetic transit access',
      emergencyExitNotes: 'Synthetic marked public exits',
      checks: 'Synthetic review only, not a real approved venue',
      reviewDate: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
    },
  };
}
export function meetingVenue(input = syntheticVenue()): MeetingVenue {
  return {
    id: input.id,
    name: input.name,
    version: input.version,
    centroid: [input.latitude, input.longitude],
    approved: input.approved,
    reviewExpiresAt: input.reviewExpiresAt,
    alcoholPrimary: input.alcoholPrimary,
    disabled: false,
    details: input.details,
  };
}
