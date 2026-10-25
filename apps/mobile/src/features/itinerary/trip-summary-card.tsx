import { formatSydneyTime, type Itinerary } from '@hopready/core';
import { StyleSheet, View } from 'react-native';

import { AppText, Card } from '@/components';
import { type ColourTokens, COMPACT_MAX_FONT_SCALE, RADII, SPACING, useTheme } from '@/theme';

import { describeRealtimeCoverage, duration, STRATEGY_LABELS, type Wording } from './trip-text';

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

export function describeTripSummary(itinerary: Itinerary): string {
  const total = duration(itinerary.durationSeconds);
  const facts = tripFacts(itinerary).map((fact) => fact.spoken);
  const coverage = describeRealtimeCoverage(itinerary);
  return [
    `${STRATEGY_LABELS[itinerary.strategy]}.`,
    `Leave ${formatSydneyTime(itinerary.departAt)}, arrive ${formatSydneyTime(itinerary.arriveAt)}.`,
    `${total.spoken} in total${facts.length > 0 ? `, ${facts.join(', ')}` : ''}.`,
    coverage?.spoken ?? null,
  ]
    .filter((part): part is string => part !== null)
    .join(' ');
}

// The top of the trip: big leave and arrive times, then the totals and how live the times are.
// VoiceOver reads it as one sentence.
export function TripSummaryCard({ itinerary }: { itinerary: Itinerary }) {
  const { colours } = useTheme();
  const total = duration(itinerary.durationSeconds);
  const facts = tripFacts(itinerary);
  const coverage = describeRealtimeCoverage(itinerary);
  const coverageStyle = COVERAGE_STYLES[itinerary.realtime];

  return (
    <Card testID="trip-summary">
      <View accessible accessibilityLabel={describeTripSummary(itinerary)} style={styles.body}>
        <AppText variant="subheadline" tone="secondary" weight="semibold">
          {STRATEGY_LABELS[itinerary.strategy]}
        </AppText>
        <View style={styles.times}>
          <View style={styles.time}>
            <AppText variant="footnote" tone="secondary">
              Leave
            </AppText>
            <AppText variant="title1" tabularNumbers>
              {formatSydneyTime(itinerary.departAt)}
            </AppText>
          </View>
          <View style={styles.time}>
            <AppText variant="footnote" tone="secondary">
              Arrive
            </AppText>
            <AppText variant="title1" tabularNumbers>
              {formatSydneyTime(itinerary.arriveAt)}
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
