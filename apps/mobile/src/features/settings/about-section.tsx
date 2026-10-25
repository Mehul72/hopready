import { PARK_AND_RIDE_RULES_URL } from '@hopready/core';
import Constants from 'expo-constants';
import { StyleSheet, View } from 'react-native';
import { z } from 'zod';

import { readSupportLinks } from '@/api';
import { AppText, Button, Card } from '@/components';
import { SPACING } from '@/theme';

import { openLink } from '../itinerary/open-link';
import { SettingsSection } from './settings-section';

// Apple's Developer Program License Agreement (section 3.3.3(F)(iii)) requires this notice from
// apps that route people using the device's location.
export const APPLE_ROUTE_GUIDANCE_NOTICE =
  'YOUR USE OF THIS REAL TIME ROUTE GUIDANCE APPLICATION IS AT YOUR SOLE RISK. LOCATION DATA MAY NOT BE ACCURATE.';

export const TFNSW_OPEN_DATA_URL = 'https://opendata.transport.nsw.gov.au/';

const appConfigSchema = z.object({ version: z.string().trim().min(1) });

// The version from the app config (app.config.ts), or null if the build has none.
export function readAppVersion(config: unknown = Constants.expoConfig): string | null {
  const parsed = appConfigSchema.safeParse(config ?? {});
  return parsed.success ? parsed.data.version : null;
}

function LinkButton({ label, url, pageName }: { label: string; url: string; pageName: string }) {
  return (
    <Button
      variant="plain"
      symbol="safari"
      label={label}
      accessibilityHint="Opens the page in HopReady"
      onPress={() => {
        void openLink(url, pageName);
      }}
    />
  );
}

export function AboutSection() {
  const version = readAppVersion();
  const { privacyPolicyUrl, supportUrl } = readSupportLinks();

  return (
    <SettingsSection title="About" testID="about">
      <AppText>
        {version ? `HopReady version ${version}` : 'HopReady (version not available)'}
      </AppText>

      <AppText variant="headline" style={styles.subheading}>
        Data sources
      </AppText>
      <AppText tone="secondary">
        Public transport times, stops, alerts and car park details come from Transport for NSW Open
        Data, used under the Creative Commons Attribution 4.0 licence (CC BY 4.0).
      </AppText>
      <LinkButton
        label="Transport for NSW Open Data"
        url={TFNSW_OPEN_DATA_URL}
        pageName="the Transport for NSW Open Data page"
      />
      <AppText tone="secondary">
        Park&amp;Ride parking rules come from Transport for NSW&apos;s Park&amp;Ride page, checked
        on the date shown with each rule.
      </AppText>
      <LinkButton
        label="Park&Ride rules"
        url={PARK_AND_RIDE_RULES_URL}
        pageName="the Park&Ride rules page"
      />
      <AppText tone="secondary">
        Maps, drive times and place search come from Apple Maps. Demo mode uses sample data instead.
      </AppText>

      {privacyPolicyUrl || supportUrl ? (
        <View style={styles.links}>
          {privacyPolicyUrl ? (
            <LinkButton
              label="Privacy policy"
              url={privacyPolicyUrl}
              pageName="the privacy policy"
            />
          ) : null}
          {supportUrl ? (
            <LinkButton label="Support" url={supportUrl} pageName="the support page" />
          ) : null}
        </View>
      ) : null}

      <Card testID="route-guidance-notice">
        <AppText variant="footnote" weight="semibold">
          {APPLE_ROUTE_GUIDANCE_NOTICE}
        </AppText>
      </Card>
    </SettingsSection>
  );
}

const styles = StyleSheet.create({
  subheading: {
    paddingTop: SPACING.md,
  },
  links: {
    alignItems: 'flex-start',
  },
});
