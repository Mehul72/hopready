import { Alert, Linking, StyleSheet, View } from 'react-native';

import { readSupportLinks } from '@/api';
import { AppText, Button, Card, Screen } from '@/components';
import { appStorage, hasLiveDataConsent, useSettings } from '@/storage';
import { SPACING } from '@/theme';

export type ConsentScreenVariant = 'first-run' | 'review';

export interface LiveDataConsentScreenProps {
  // 'first-run' asks before anything is sent; 'review' is the same explanation opened from
  // Settings, where agreement can also be withdrawn.
  variant: ConsentScreenVariant;
  onDone?: () => void;
  now?: () => Date;
}

// Kept in step with site/privacy/index.html. A change to what is sent, or who receives it, also
// needs LIVE_DATA_CONSENT_VERSION bumped once a version has shipped.
const SENT = [
  "The places you search for and travel between, and when you want to travel, go to HopReady's server. Planning with I'll drive and park also sends the parking spots you saved, and Take me home sends where your car is.",
  'If you allow location, searches also send your approximate location (to about 1 km) so nearby places come first, and iOS asks Apple for the street name when you use your current location.',
  'The server asks Transport for NSW for public transport and car parks, and Apple Maps for places and drive times. They are not told who you are.',
  "HopReady's server does not keep your places or searches after answering.",
] as const;

const KEPT = [
  'Home, work, favourites, recent trips and where you parked are saved only on this iPhone, and leave it only inside a search or trip you ask for.',
  'Delete all HopReady data in Settings erases them.',
] as const;

const agreedDateFormatter = new Intl.DateTimeFormat('en-AU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

// Safari rather than an in-app browser: the App Store age rating declares no web browsing in the app.
async function openPrivacyPolicy(url: string): Promise<void> {
  try {
    await Linking.openURL(url);
  } catch (error) {
    console.warn(
      `HopReady: could not open the privacy policy (${error instanceof Error ? error.name : 'unknown error'}).`,
    );
    Alert.alert("Couldn't open the privacy policy", "Safari didn't open. Try again.");
  }
}

function Points({ title, points }: { title: string; points: readonly string[] }) {
  return (
    <Card>
      <View style={styles.points}>
        <AppText variant="headline" accessibilityRole="header">
          {title}
        </AppText>
        {points.map((point) => (
          <AppText key={point} variant="callout">
            {point}
          </AppText>
        ))}
      </View>
    </Card>
  );
}

// Live trip planning sends personal data (places and times) to HopReady's server and on to
// Transport for NSW and Apple, so it waits for agreement. Demo mode is the way to say no.
export function LiveDataConsentScreen({
  variant,
  onDone,
  now = () => new Date(),
}: LiveDataConsentScreenProps) {
  const settings = useSettings();
  const agreed = hasLiveDataConsent(settings);
  const agreedOn =
    agreed && settings.liveDataConsent
      ? agreedDateFormatter.format(new Date(settings.liveDataConsent.acceptedAt))
      : null;
  const { privacyPolicyUrl } = readSupportLinks();

  const agree = () => {
    appStorage.settings.acceptLiveDataConsent(now());
    onDone?.();
  };
  const useDemoMode = () => {
    appStorage.settings.setDemoMode(true);
    onDone?.();
  };
  const withdraw = () => {
    appStorage.settings.withdrawLiveDataConsent();
    onDone?.();
  };

  const firstRun = variant === 'first-run';
  const footer = (
    <View style={styles.actions}>
      {agreed && !firstRun ? (
        <Button
          variant="secondary"
          label="Withdraw agreement"
          accessibilityHint="Live trips stop until you agree again. Demo mode still works."
          onPress={withdraw}
          fullWidth
        />
      ) : (
        <>
          <Button label="Agree and continue" onPress={agree} fullWidth />
          {settings.demoMode ? null : (
            <Button
              variant="secondary"
              label="Use demo mode instead"
              accessibilityHint="Sample trips on real stops. Nothing is sent to HopReady's server."
              onPress={useDemoMode}
              fullWidth
            />
          )}
        </>
      )}
    </View>
  );

  return (
    <Screen footer={footer} safeAreaEdges={firstRun ? ['top'] : []} testID="live-data-consent">
      <View style={styles.intro}>
        <AppText variant={firstRun ? 'largeTitle' : 'title2'} accessibilityRole="header">
          {firstRun ? 'Before your first live trip' : 'Live data use'}
        </AppText>
        <AppText variant="body" tone="secondary">
          HopReady plans with live data from Transport for NSW and Apple Maps. To do that, some
          details leave your iPhone.
        </AppText>
      </View>
      <Points title="What is sent" points={SENT} />
      <Points title="What stays on this iPhone" points={KEPT} />
      {privacyPolicyUrl ? (
        <Button
          variant="plain"
          label="Read the privacy policy"
          symbol="hand.raised"
          onPress={() => void openPrivacyPolicy(privacyPolicyUrl)}
        />
      ) : null}
      <AppText variant="footnote" tone="secondary">
        {agreedOn
          ? `You agreed on ${agreedOn}. You can withdraw at any time.`
          : "Demo mode sends nothing to HopReady's server. You can change your mind later in Settings."}
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: {
    gap: SPACING.sm,
  },
  points: {
    gap: SPACING.sm,
  },
  actions: {
    gap: SPACING.sm,
  },
});
