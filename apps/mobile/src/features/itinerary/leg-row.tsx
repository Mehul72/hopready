import {
  type DriveLeg,
  formatSydneyTime,
  type Leg,
  legSeconds,
  type ParkLeg,
  type RideLeg,
  type ServiceAlert,
  type TransitLeg,
  type WalkLeg,
} from '@hopready/core';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Banner, Button, Card, ModeIcon, TimingBadge, timingStyleFor } from '@/components';
import { LEG_VISUALS, legVisualKind, SPACING } from '@/theme';

import { describeOccupancy, SPACES_CAN_FILL_NOTE } from '../shared/occupancy-wording';
import { isSampleLeg } from '../shared/sample-data';
import { openLink } from './open-link';
import {
  ALERT_TONES,
  describeDelay,
  departurePlatformOf,
  describeRules,
  distance,
  duration,
  platformToAdd,
  serviceTitle,
  statedPlatform,
  type StepNotes,
  stopCount,
  type Wording,
} from './trip-text';
import type { DriveDestination } from './use-start-driving';

export interface LegRowProps {
  leg: Leg;
  // The current minute, for the age of car park counts.
  nowMs: number;
  // When the trip's times were checked, once that is too long ago to call them live
  // (staleCheckOf).
  staleCheckAt: string | null;
  onStartDriving: (destination: DriveDestination) => void;
  // From describeStepNotes. Only walks, waits and services ever get any, so only their rows
  // show them.
  notes?: StepNotes;
}

// One step of the trip. Each card is one VoiceOver element that reads the step as a sentence;
// buttons and links inside it stay separate so they can still be reached and activated.
export function LegRow({ leg, nowMs, staleCheckAt, onStartDriving, notes = [] }: LegRowProps) {
  switch (leg.kind) {
    case 'drive':
      return <DriveRow leg={leg} onStartDriving={onStartDriving} />;
    case 'ride':
      return <RideRow leg={leg} />;
    case 'walk':
      return <WalkRow leg={leg} notes={notes} />;
    case 'transit':
      return <TransitRow leg={leg} notes={notes} staleCheckAt={staleCheckAt} />;
    case 'park':
      return <ParkRow leg={leg} nowMs={nowMs} />;
    case 'drop-off':
      return (
        <BufferRow
          leg={leg}
          title={`Drop-off at ${leg.to.name}`}
          purpose="to get out and head to your service"
          bufferName="drop-off buffer"
        />
      );
    case 'wait':
      return <WaitRow leg={leg} notes={notes} />;
    case 'car-retrieval':
      return (
        <BufferRow
          leg={leg}
          title={`Back to your car at ${leg.to.name}`}
          purpose="to reach your car and drive off"
          bufferName="car retrieval buffer"
        />
      );
  }
}

interface LegCardProps {
  leg: Leg;
  title: string;
  // The whole step as one sentence, without the start time (added here).
  spoken: string;
  details?: ReactNode;
  notes?: StepNotes;
  // Buttons, links and alerts, outside the spoken summary.
  actions?: ReactNode;
}

function LegCard({ leg, title, spoken, details, notes = [], actions }: LegCardProps) {
  const start = formatSydneyTime(leg.start);
  const label = [`${start}.`, spoken, ...notes.map((note) => note.spoken)].join(' ');
  return (
    <Card testID={`leg-${leg.kind}`}>
      <View accessible accessibilityLabel={label} style={styles.summary}>
        <View style={styles.header}>
          <ModeIcon mode={legVisualKind(leg)} size={20} showLabel />
          <AppText variant="subheadline" tone="secondary" weight="semibold" tabularNumbers>
            {start}
          </AppText>
        </View>
        <AppText variant="headline">{title}</AppText>
        {details}
        {notes.map((note) => (
          <Detail key={note.text}>{note.text}</Detail>
        ))}
      </View>
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </Card>
  );
}

function Detail({ children }: { children: ReactNode }) {
  return (
    <AppText variant="subheadline" tone="secondary">
      {children}
    </AppText>
  );
}

function joinWords(parts: readonly (Wording | null)[]): Wording {
  const present = parts.filter((part): part is Wording => part !== null);
  return {
    text: present.map((part) => part.text).join(' · '),
    spoken: present.map((part) => part.spoken).join(', '),
  };
}

function trafficWording(leg: DriveLeg | RideLeg): Wording {
  return leg.trafficAware
    ? { text: 'Estimate with traffic', spoken: 'estimate with traffic' }
    : { text: 'Estimate without live traffic', spoken: 'estimate without live traffic' };
}

function DriveRow({
  leg,
  onStartDriving,
}: {
  leg: DriveLeg;
  onStartDriving: (destination: DriveDestination) => void;
}) {
  const time = duration(legSeconds(leg));
  const facts = joinWords([distance(leg.distanceMetres), trafficWording(leg)]);
  return (
    <LegCard
      leg={leg}
      title={`Drive ${time.text} to ${leg.to.name}`}
      spoken={`Drive ${time.spoken} to ${leg.to.name}, ${facts.spoken}.`}
      details={<Detail>{facts.text}</Detail>}
      actions={
        <Button
          variant="secondary"
          symbol="car.fill"
          label="Start driving"
          accessibilityLabel={`Start driving to ${leg.to.name}`}
          accessibilityHint="Opens a navigation app with directions"
          onPress={() => onStartDriving({ name: leg.to.name, coordinate: leg.to.coordinate })}
        />
      }
    />
  );
}

function RideRow({ leg }: { leg: RideLeg }) {
  const time = duration(legSeconds(leg));
  const facts = joinWords([
    { text: `${time.text} ride`, spoken: `${time.spoken} ride` },
    distance(leg.distanceMetres),
    trafficWording(leg),
  ]);
  return (
    <LegCard
      leg={leg}
      title={`Get dropped off at ${leg.to.name}`}
      spoken={`Get dropped off at ${leg.to.name}, ${facts.spoken}.`}
      details={<Detail>{facts.text}</Detail>}
    />
  );
}

function WalkRow({ leg, notes }: { leg: WalkLeg; notes: StepNotes }) {
  const seconds = legSeconds(leg);
  // Transport for NSW marks a change of platform or stop without always giving a walking time.
  // "Walk 0 min" would read as no walk at all, so the change itself is the step.
  if (seconds === 0) {
    return (
      <LegCard
        leg={leg}
        title={`Change to ${leg.to.name}`}
        spoken={`Change to ${leg.to.name}. Walking time not given.`}
        details={<Detail>Walking time not given</Detail>}
        notes={notes}
      />
    );
  }
  const time = duration(seconds);
  const length = leg.distanceMetres === null ? null : distance(leg.distanceMetres);
  return (
    <LegCard
      leg={leg}
      title={`Walk ${time.text} to ${leg.to.name}`}
      spoken={`Walk ${time.spoken} to ${leg.to.name}${length ? `, ${length.spoken}` : ''}.`}
      details={length ? <Detail>{length.text}</Detail> : null}
      notes={notes}
    />
  );
}

function WaitRow({ leg, notes }: { leg: Leg; notes: StepNotes }) {
  const time = duration(legSeconds(leg));
  return (
    <LegCard
      leg={leg}
      title={`Wait ${time.text} at ${leg.from.name}`}
      spoken={`Wait ${time.spoken} at ${leg.from.name}.`}
      notes={notes}
    />
  );
}

// Park, drop-off and car retrieval are the person's own buffers from Settings, so the card says
// what the time is for instead of presenting it as a provider estimate.
function BufferRow({
  leg,
  title,
  purpose,
  bufferName,
}: {
  leg: Leg;
  title: string;
  purpose: string;
  bufferName: string;
}) {
  const time = duration(legSeconds(leg));
  const explanation = `${time.text} ${purpose} (your ${bufferName}).`;
  return (
    <LegCard
      leg={leg}
      title={title}
      spoken={`${title}. ${time.spoken} ${purpose}, your ${bufferName}.`}
      details={<Detail>{explanation}</Detail>}
    />
  );
}

function ParkRow({ leg, nowMs }: { leg: ParkLeg; nowMs: number }) {
  const { carPark, occupancy, rules } = leg.parking;
  const time = duration(legSeconds(leg));
  const spaces = describeOccupancy(occupancy, new Date(nowMs));
  const parkingRules = describeRules(rules);
  const purpose = 'to find a space, park and reach the exit';
  const title = `Park at ${carPark.name}`;

  return (
    <LegCard
      leg={leg}
      title={title}
      spoken={`${title}. ${time.spoken} ${purpose}, your parking buffer. Spaces: ${spaces.spoken}. ${SPACES_CAN_FILL_NOTE} ${parkingRules.spoken}`}
      details={
        <>
          <Detail>{`${time.text} ${purpose} (your parking buffer).`}</Detail>
          <View style={styles.section} testID="parking-occupancy">
            <AppText variant="footnote" weight="semibold">
              Spaces
            </AppText>
            <AppText variant="subheadline" tabularNumbers>
              {spaces.summary}
            </AppText>
            {spaces.detail ? <Detail>{spaces.detail}</Detail> : null}
            <Detail>{SPACES_CAN_FILL_NOTE}</Detail>
          </View>
          <View style={styles.section} testID="parking-rules">
            <AppText variant="footnote" weight="semibold">
              Parking rules
            </AppText>
            <AppText variant="subheadline">{parkingRules.summary}</AppText>
          </View>
        </>
      }
      actions={parkingRules.source ? <ParkingRulesSourceLink source={parkingRules.source} /> : null}
    />
  );
}

function ParkingRulesSourceLink({ source }: { source: { url: string; label: string } }) {
  return (
    <Button
      variant="plain"
      symbol="safari"
      label={source.label}
      accessibilityHint="Opens the page these parking rules come from"
      onPress={() => {
        void openLink(source.url, 'the parking rules page');
      }}
    />
  );
}

function TransitRow({
  leg,
  notes,
  staleCheckAt,
}: {
  leg: TransitLeg;
  notes: StepNotes;
  staleCheckAt: string | null;
}) {
  const modeName = LEG_VISUALS[leg.mode].label;
  const title = serviceTitle(leg);
  const platform = platformToAdd(leg.from.name, departurePlatformOf(leg));
  // The arrival platform helps with finding the exit or the next service, but nobody needs it to
  // get off, so it is shown only when stated rather than called missing.
  const arrivalPlatform = platformToAdd(leg.to.name, statedPlatform(leg.arrivalPlatform));
  const arrival = arrivalPlatform ? `${leg.to.name}, ${arrivalPlatform}` : leg.to.name;
  const stops = stopCount(leg.stopCount);
  const delay = describeDelay(leg);
  const arrive = formatSydneyTime(leg.end);
  const sample = isSampleLeg(leg);
  const timing = timingStyleFor(leg.timing, sample, staleCheckAt).spoken;
  const spokenParts = [
    `${modeName} ${title}`,
    `From ${leg.from.name}${platform ? `, ${platform}` : ''}`,
    `To ${arrival}, arriving ${arrive}`,
    stops,
    leg.cancelled ? 'This service is cancelled' : null,
    delay ? `${timing}, ${delay.spoken}` : timing,
    leg.alerts.length > 0
      ? `${leg.alerts.length} service ${leg.alerts.length === 1 ? 'alert' : 'alerts'}`
      : null,
  ].filter((part): part is string => part !== null);

  return (
    <LegCard
      leg={leg}
      title={title}
      spoken={`${spokenParts.join('. ')}.`}
      details={
        <>
          <Detail>{`From ${leg.from.name}${platform ? ` · ${platform}` : ''}`}</Detail>
          <Detail>{[`To ${arrival}, arrive ${arrive}`, stops].filter(Boolean).join(' · ')}</Detail>
          <View style={styles.badges}>
            <TimingBadge timing={leg.timing} sample={sample} staleCheckAt={staleCheckAt} />
            {delay ? (
              <AppText variant="footnote" weight="semibold">
                {delay.text}
              </AppText>
            ) : null}
          </View>
        </>
      }
      notes={notes}
      actions={
        leg.cancelled || leg.alerts.length > 0 ? (
          <>
            {leg.cancelled ? <Banner tone="error" message="This service is cancelled." /> : null}
            {leg.alerts.map((alert) => (
              <AlertBanner key={alert.id} alert={alert} />
            ))}
          </>
        ) : null
      }
    />
  );
}

export function AlertBanner({ alert }: { alert: ServiceAlert }) {
  const { url } = alert;
  return (
    <Banner
      tone={ALERT_TONES[alert.severity]}
      title={alert.detail ? alert.title : undefined}
      message={alert.detail ?? alert.title}
      action={
        url
          ? {
              label: 'More about this alert',
              onPress: () => {
                void openLink(url, 'the alert page');
              },
            }
          : undefined
      }
    />
  );
}

// The final row: where and when the trip ends.
export function ArrivalRow({ leg }: { leg: Leg }) {
  const arrive = formatSydneyTime(leg.end);
  return (
    <Card testID="arrival">
      <View
        accessible
        accessibilityLabel={`${arrive}. Arrive at ${leg.to.name}.`}
        style={styles.summary}>
        <AppText variant="subheadline" tone="secondary" weight="semibold" tabularNumbers>
          {arrive}
        </AppText>
        <AppText variant="headline">{`Arrive at ${leg.to.name}`}</AppText>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  summary: {
    gap: SPACING.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  section: {
    gap: SPACING.xxs,
    paddingTop: SPACING.sm,
  },
  badges: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    paddingTop: SPACING.xs,
  },
  actions: {
    gap: SPACING.sm,
    paddingTop: SPACING.md,
    alignItems: 'flex-start',
  },
});
