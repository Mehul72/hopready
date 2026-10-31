import type { Itinerary } from '@hopready/core';
import { StyleSheet, View } from 'react-native';

import { AppText, Card } from '@/components';
import { type ColourTokens, COMPACT_MAX_FONT_SCALE, RADII, SPACING, useTheme } from '@/theme';

import { tripTimes } from '../results/route-summary';
import { isSampleItinerary } from '../shared/sample-data';
import { shownDurationSeconds } from '../shared/shown-duration';
import { optionLabel } from '../shared/option-labels';
import { describeRealtimeCoverage, duration, type Wording } from './trip-text';

interface CoverageStyle {
  background: keyof ColourTokens;
  foreground: keyof ColourTokens;
}

const COVERAGE_STYLES: Readonly<Record<Itinerary['realtime'], CoverageStyle>> = {
  full: { background: 'successSoft', foreground: 'onSuccessSoft' },
  partial: { background: 'infoSoft', foreground: 'onInfoSoft' },
  none: { background: 'surfaceMuted', foreground: 'textSecondary' },
};

function changesWording(transfers: number): Wording {
  if (transfers === 0) return { text: 'No changes', spoken: 'no changes' };
  const text = transfers === 1 ? '1 change' : `${transfers} changes`;
  return { text, spoken: text };
}

// Time in the car, walking and changes, each only when the trip has any.
function tripFacts(itinerary: Itinerary): Wording[] {
  const hasTransit = itinerary.legs.some((leg) => leg.kind === 'transit');
  const drivesThemselves = itinerary.legs.some((leg) => leg.kind === 'drive');
  const facts: Wording[] = [];
  if (itinerary.driveSeconds > 0) {
    const time = duration(itinerary.driveSeconds);
    facts.push(
      drivesThemselves
        ? { text: `${time.text} driving`, spoken: `${time.spoken} driving` }
        : { text: `${time.text} in the car`, spoken: `${time.spoken} in the car` },
    );
  }
  if (itinerary.walkSeconds > 0) {
    const time = duration(itinerary.walkSeconds);
    facts.push({ text: `${time.text} walking`, spoken: `${time.spoken} walking` });
  }
  if (hasTransit) facts.push(changesWording(itinerary.transfers));
  return facts;
}

// `sameDayAs` is today, so a time on another day says which.
export function describeTripSummary(
  itinerary: Itinerary,
  staleCheckAt: string | null = null,
  sameDayAs: Date | null = null,
): string {
  const total = duration(shownDurationSeconds(itinerary));
  const facts = tripFacts(itinerary).map((fact) => fact.spoken);
  const coverage = describeRealtimeCoverage(itinerary, staleCheckAt, sameDayAs ?? new Date());
  const times = tripTimes(itinerary, sameDayAs);
  return [
    `${optionLabel(itinerary)}.`,
    `Leave ${times.leave.spoken}, arrive ${times.arrive.spoken}.`,
    `${total.spoken} in total${facts.length > 0 ? `, ${facts.join(', ')}` : ''}.`,
    coverage?.spoken ?? null,
  ]
    .filter((part): part is string => part !== null)
    .join(' ');
}

// The top of the trip: big leave and arrive times, then the totals and how live the times are.
// VoiceOver reads it as one sentence. `staleCheckAt` is set once live times are too old to call
// live (staleCheckOf). `sameDayAs` is today: the trip screen has no header naming the day asked
// for, so a trip tomorrow morning says so.
export function TripSummaryCard({
  itinerary,
  staleCheckAt = null,
  sameDayAs = null,
}: {
  itinerary: Itinerary;
  staleCheckAt?: string | null;
  sameDayAs?: Date | null;
}) {
  const { colours } = useTheme();
  const times = tripTimes(itinerary, sameDayAs);
  const total = duration(shownDurationSeconds(itinerary));
  const facts = tripFacts(itinerary);
  const coverage = describeRealtimeCoverage(itinerary, staleCheckAt, sameDayAs ?? new Date());
  // Old live times lose the live colour with the word. Sample times keep theirs.
  const coverageStyle =
    COVERAGE_STYLES[staleCheckAt && !isSampleItinerary(itinerary) ? 'none' : itinerary.realtime];

  return (
    <Card testID="trip-summary">
      <View
        accessible
        accessibilityLabel={describeTripSummary(itinerary, staleCheckAt, sameDayAs)}
        style={styles.body}>
        <AppText variant="subheadline" tone="secondary" weight="semibold">
          {optionLabel(itinerary)}
        </AppText>
        <View style={styles.times}>
          <View style={styles.time}>
            <AppText variant="footnote" tone="secondary">
              Leave
            </AppText>
            <AppText variant="title1" tabularNumbers>
              {times.leave.text}
            </AppText>
          </View>
          <View style={styles.time}>
            <AppText variant="footnote" tone="secondary">
              Arrive
            </AppText>
            <AppText variant="title1" tabularNumbers>
              {times.arrive.text}
            </AppText>
          </View>
        </View>
        <AppText variant="headline" tabularNumbers>
          {`${total.text} total`}
        </AppText>
        {facts.length > 0 ? (
          <AppText variant="subheadline" tone="secondary" tabularNumbers>
            {facts.map((fact) => fact.text).join(' · ')}
          </AppText>
        ) : null}
        {coverage ? (
          <View style={[styles.coverage, { backgroundColor: colours[coverageStyle.background] }]}>
            <AppText
              variant="caption"
              weight="semibold"
              colour={colours[coverageStyle.foreground]}
              maxFontSizeMultiplier={COMPACT_MAX_FONT_SCALE}>
              {coverage.text}
            </AppText>
          </View>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: SPACING.sm,
  },
  times: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: SPACING.xxl,
    rowGap: SPACING.sm,
  },
  time: {
    gap: SPACING.xxs,
  },
  coverage: {
    alignSelf: 'flex-start',
    borderRadius: RADII.pill,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xxs,
  },
});
