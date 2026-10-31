import { type Itinerary, type Preferences, type ServiceAlert } from '@hopready/core';
import { type SFSymbol, SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import {
  AppText,
  Card,
  colourForTone,
  ModeIcon,
  type TextTone,
  TIMING_STYLES,
  TimingBadge,
} from '@/components';
import { COMPACT_MAX_FONT_SCALE, type ColourTokens, RADII, SPACING, useTheme } from '@/theme';

import type { Wording } from '../shared/occupancy-wording';
import { optionLabel } from '../shared/option-labels';
import {
  alertSummary,
  concernSummaries,
  describeItinerary,
  type LegStep,
  legSteps,
  parkingSummary,
  type TimingSummary,
  TIMING_SUMMARY_WORDING,
  timingSummary,
  tripFacts,
  tripTimes,
} from './route-summary';

interface PillStyle {
  background: keyof ColourTokens;
  tone: TextTone;
  symbol: SFSymbol;
}

// The badge takes the look of the most serious alert, with a different symbol for each level.
const ALERT_STYLES: Readonly<Record<ServiceAlert['severity'], PillStyle>> = {
  info: { background: 'infoSoft', tone: 'onInfoSoft', symbol: 'info.circle.fill' },
  warning: {
    background: 'warningSoft',
    tone: 'onWarningSoft',
    symbol: 'exclamationmark.triangle.fill',
  },
  severe: { background: 'dangerSoft', tone: 'onDangerSoft', symbol: 'xmark.octagon.fill' },
};

// A mark against the person's own limit is a caution, never an error: the option still works.
const CONCERN_STYLE: PillStyle = {
  background: 'warningSoft',
  tone: 'onWarningSoft',
  symbol: 'exclamationmark.triangle.fill',
};

export interface RouteCardProps {
  itinerary: Itinerary;
  now: Date;
  // When the options were checked, once that is too long ago to call their times live
  // (staleCheckOf).
  staleCheckAt: string | null;
  // The limits and buffers the trip was planned with, which the planner's marks are read against.
  preferences: Preferences;
  // The time the trip was asked for, so a time on another day can say which day.
  requestedAt: string;
  // The option the person chose to follow, if it is this one.
  selected: boolean;
  onPress: () => void;
}

function Pill({ style, wording }: { style: PillStyle; wording: Wording }) {
  const { colours } = useTheme();
  return (
    <View style={[styles.pill, { backgroundColor: colours[style.background] }]}>
      <SymbolView name={style.symbol} tintColor={colourForTone(colours, style.tone)} size={12} />
      <AppText
        variant="caption"
        tone={style.tone}
        weight="semibold"
        maxFontSizeMultiplier={COMPACT_MAX_FONT_SCALE}>
        {wording.text}
      </AppText>
    </View>
  );
}

function TimingPill({
  summary,
  staleCheckAt,
}: {
  summary: TimingSummary;
  staleCheckAt: string | null;
}) {
  if (summary === 'live') return <TimingBadge timing="realtime" staleCheckAt={staleCheckAt} />;
  if (summary === 'sample-live') return <TimingBadge timing="realtime" sample />;
  if (summary === 'timetable') return <TimingBadge timing="scheduled" />;
  if (summary === 'estimate') return <TimingBadge timing="estimated" />;
  // Old partly live times say when they were checked, as old live ones do.
  if (staleCheckAt) return <TimingBadge timing="realtime" staleCheckAt={staleCheckAt} />;
  // Partly live is not a single leg timing, so it borrows the live badge's look with its own words.
  return <Pill style={TIMING_STYLES.realtime} wording={TIMING_SUMMARY_WORDING[summary]} />;
}

function StepChip({ step }: { step: LegStep }) {
  const { modeColours, onModeColour } = useTheme();
  return (
    <View style={styles.step}>
      <ModeIcon mode={step.kind} size={16} />
      {step.serviceName ? (
        <View style={[styles.serviceBadge, { backgroundColor: modeColours[step.kind] }]}>
          <AppText
            variant="caption"
            weight="bold"
            colour={onModeColour}
            maxFontSizeMultiplier={COMPACT_MAX_FONT_SCALE}>
            {step.serviceName}
          </AppText>
        </View>
      ) : null}
      <AppText variant="footnote" tabularNumbers>
        {step.duration.text}
      </AppText>
    </View>
  );
}

// One trip option, kept to what decides between options: the times, the steps, one line of facts,
// the car park's count, and any marks. The steps and map are behind a tap. The whole card is a
// single button whose spoken label reads the option as one sentence.
export function RouteCard({
  itinerary,
  now,
  staleCheckAt,
  preferences,
  requestedAt,
  selected,
  onPress,
}: RouteCardProps) {
  const { colours } = useTheme();
  const facts = tripFacts(itinerary);
  const steps = legSteps(itinerary);
  const parking = parkingSummary(itinerary, now);
  const alerts = alertSummary(itinerary);
  const concerns = concernSummaries(itinerary, preferences);
  const times = tripTimes(itinerary, requestedAt);
  // "Drive · Drive 52 min" says it twice, and the steps row already shows the drive.
  const driving = itinerary.strategy === 'drive-only' ? null : facts.driving;
  const factLine = [optionLabel(itinerary), driving, facts.walking, facts.changes]
    .flatMap((fact) => (fact ? [typeof fact === 'string' ? fact : fact.text] : []))
    .join(' · ');

  return (
    <Card
      onPress={onPress}
      selected={selected}
      accessibilityLabel={describeItinerary(itinerary, now, staleCheckAt, preferences, requestedAt)}
      accessibilityHint="Opens the steps and map for this option"
      testID={`route-card-${itinerary.id}`}>
      <View style={styles.content}>
        <View style={styles.timesRow}>
          <AppText variant="title2" tabularNumbers style={styles.shrink}>
            {`${times.leave.text} → ${times.arrive.text}`}
          </AppText>
          <AppText variant="headline" tabularNumbers>
            {facts.total.text}
          </AppText>
        </View>
        <View style={styles.steps}>
          {steps.map((step, index) => (
            <View key={step.key} style={styles.stepWithSeparator}>
              {index > 0 ? (
                <SymbolView name="chevron.right" tintColor={colours.textSecondary} size={10} />
              ) : null}
              <StepChip step={step} />
            </View>
          ))}
        </View>
        <View style={styles.factsRow}>
          <AppText variant="footnote" tone="secondary" tabularNumbers style={styles.shrink}>
            {factLine}
          </AppText>
          <TimingPill summary={timingSummary(itinerary)} staleCheckAt={staleCheckAt} />
        </View>
        {parking ? (
          <View style={styles.parking}>
            <ModeIcon mode="park" size={16} />
            <AppText variant="footnote" style={styles.shrink}>
              {`${parking.carParkName} · ${parking.occupancy.summary}`}
            </AppText>
          </View>
        ) : null}
        {/* Caveats the planner attached, such as a drive time that leaves out parking. */}
        {itinerary.notes.map((note) => (
          <AppText key={note} variant="footnote" tone="secondary">
            {note}
          </AppText>
        ))}
        {concerns.length > 0 || alerts ? (
          <View style={styles.pills}>
            {concerns.map((concern) => (
              <Pill key={concern.text} style={CONCERN_STYLE} wording={concern} />
            ))}
            {alerts ? (
              <Pill style={ALERT_STYLES[alerts.severity]} wording={alerts.wording} />
            ) : null}
          </View>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: SPACING.sm,
  },
  shrink: {
    flexShrink: 1,
  },
  timesRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    columnGap: SPACING.md,
    rowGap: SPACING.xxs,
  },
  steps: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    rowGap: SPACING.xs,
  },
  stepWithSeparator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    marginRight: SPACING.xs,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xxs,
  },
  serviceBadge: {
    borderRadius: RADII.sm,
    paddingHorizontal: SPACING.xs,
  },
  factsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    columnGap: SPACING.sm,
    rowGap: SPACING.xs,
  },
  parking: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: SPACING.xxs,
    borderRadius: RADII.pill,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xxs,
  },
});
