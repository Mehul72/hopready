import { useEffect } from 'react';
import { AccessibilityInfo } from 'react-native';

export function searchOutcomeAnnouncement(resultCount: number): string {
  if (resultCount === 0) return 'No matches';
  return resultCount === 1 ? '1 place found' : `${resultCount} places found`;
}

// VoiceOver focus stays in the search field while results replace the loading rows, so without
// this a person cannot tell the search finished. Spoken once per answer.
export function useAnnounceSearchOutcome(answer: unknown, resultCount: number): void {
  useEffect(() => {
    if (answer === undefined) return;
    AccessibilityInfo.announceForAccessibility(searchOutcomeAnnouncement(resultCount));
  }, [answer, resultCount]);
}
