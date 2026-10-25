import { formatSydneyTime, type Itinerary, type ServiceAlert } from '@hopready/core';
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

import { STRATEGY_LABELS } from './plan-explanations';
import {
  alertSummary,
  describeItinerary,
  type LegStep,
  legSteps,
  parkingSummary,
  type TimingSummary,
  TIMING_SUMMARY_WORDING,
  timingSummary,
  tripFacts,
} from './route-summary';

// The badge takes the look of the most serious alert, with a different symbol for each level.
const ALERT_STYLES: Readonly<
  Record<
    ServiceAlert['severity'],
    { background: keyof ColourTokens; tone: TextTone; symbol: SFSymbol }
  >
> = {
  info: { background: 'infoSoft', tone: 'onInfoSoft', symbol: 'info.circle.fill' },
  warning: {
    background: 'warningSoft',
    tone: 'onWarningSoft',
    symbol: 'exclamationmark.triangle.fill',
  },
  severe: { background: 'dangerSoft', tone: 'onDangerSoft', symbol: 'xmark.octagon.fill' },
};

export interface RouteCardProps {
  itinerary: Itinerary;
  now: Date;
  // The option the person chose to follow, if it is this one.
  selected: boolean;
  onPress: () => void;
}

function TimingPill({ summary }: { summary: TimingSummary }) {
  const { colours } = useTheme();
  if (summary === 'live') return <TimingBadge timing="realtime" />;
  if (summary === 'sample-live') return <TimingBadge timing="realtime" sample />;
  if (summary === 'timetable') return <TimingBadge timing="scheduled" />;
  if (summary === 'estimate') return <TimingBadge timing="estimated" />;
  // Partly live is not a single leg timing, so it borrows the live badge's look with its own words.
  const style = TIMING_STYLES.realtime;
  return (
    <View style={[styles.pill, { backgroundColor: colours[style.background] }]}>
      <SymbolView name={style.symbol} tintColor={colourForTone(colours, style.tone)} size={12} />
      <AppText
        variant="caption"
        tone={style.tone}
        weight="semibold"
        maxFontSizeMultiplier={COMPACT_MAX_FONT_SCALE}>
        {TIMING_SUMMARY_WORDING[summary].text}
      </AppText>
    </View>
  );
}

function TimeBlock({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.timeBlock}>
      <AppText variant="caption" tone="secondary">
        {label}
      </AppText>
      <AppText variant="title2" tabularNumbers>
        {value}
      </AppText>
    </View>
  );
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

// One trip option. The whole card is a single button whose spoken label reads the option as one
// sentence; the pieces inside are for the eye.
export function RouteCard({ itinerary, now, selected, onPress }: RouteCardProps) {
  const { colours } = useTheme();
  const facts = tripFacts(itinerary);
  const steps = legSteps(itinerary);
  const parking = parkingSummary(itinerary, now);
  const alerts = alertSummary(itinerary);
  const factLine = [facts.driving, facts.walking, facts.changes]
    .flatMap((fact) => (fact ? [fact.text] : []))
    .join(' · ');

  return (
    <Card
      onPress={onPress}
      selected={selected}
      accessibilityLabel={describeItinerary(itinerary, now)}
      accessibilityHint="Opens the steps and map for this option"
      testID={`route-card-${itinerary.id}`}>
      <View style={styles.content}>
        <View style={styles.headerRow}>
          <AppText variant="subheadline" tone="secondary" weight="semibold" style={styles.shrink}>
            {STRATEGY_LABELS[itinerary.strategy]}
          </AppText>
          <TimingPill summary={timingSummary(itinerary)} />
        </View>
        <View style={styles.timesRow}>
          <TimeBlock label="Leave" value={formatSydneyTime(itinerary.departAt)} />
          <SymbolView name="arrow.right" tintColor={colours.textSecondary} size={16} />
          <TimeBlock label="Arrive" value={formatSydneyTime(itinerary.arriveAt)} />
          <View style={styles.total}>
            <AppText variant="caption" tone="secondary">
              Total
            </AppText>
            <AppText variant="headline" tabularNumbers>
              {facts.total.text}
            </AppText>
          </View>
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
        {factLine ? (
          <AppText variant="footnote" tone="secondary" tabularNumbers>
            {factLine}
          </AppText>
        ) : null}
        {parking ? (
          <View style={[styles.parking, { backgroundColor: colours.surfaceMuted }]}>
            <ModeIcon mode="park" size={18} />
            <View style={styles.shrink}>
              <AppText variant="subheadline" weight="semibold">
                {parking.carParkName}
              </AppText>
              <AppText variant="footnote">{parking.occupancy.text}</AppText>
              <AppText variant="footnote" tone="secondary">
                {parking.note}
              </AppText>
              {parking.rulesNote ? (
                <AppText variant="footnote" weight="semibold">
                  {parking.rulesNote}
                </AppText>
              ) : null}
            </View>
          </View>
        ) : null}
        {alerts ? (
          <View
            style={[
              styles.pill,
              { backgroundColor: colours[ALERT_STYLES[alerts.severity].background] },
            ]}>
            <SymbolView
              name={ALERT_STYLES[alerts.severity].symbol}
              tintColor={colourForTone(colours, ALERT_STYLES[alerts.severity].tone)}
              size={12}
            />
            <AppText
              variant="caption"
              weight="semibold"
              tone={ALERT_STYLES[alerts.severity].tone}
              maxFontSizeMultiplier={COMPACT_MAX_FONT_SCALE}>
              {alerts.wording.text}
            </AppText>
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  shrink: {
    flexShrink: 1,
  },
  timesRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
    columnGap: SPACING.md,
    rowGap: SPACING.xs,
  },
  timeBlock: {
    gap: SPACING.xxs,
  },
  total: {
    marginLeft: 'auto',
    alignItems: 'flex-end',
    gap: SPACING.xxs,
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
  parking: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
    borderRadius: RADII.md,
    padding: SPACING.sm,
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
