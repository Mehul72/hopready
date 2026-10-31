import { type SFSymbol, SymbolView } from 'expo-symbols';
import { useEffect } from 'react';
import { AccessibilityInfo, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';

import { type ColourTokens, RADII, SPACING, useTheme } from '@/theme';

import { AppText, type TextTone } from './app-text';
import { Button } from './button';

export type BannerTone = 'info' | 'warning' | 'error' | 'demo';

export interface BannerProps {
  tone: BannerTone;
  title?: string;
  message: string;
  // What VoiceOver reads instead of `message`, such as times with the weekday in full.
  spokenMessage?: string;
  action?: { label: string; onPress: () => void; accessibilityHint?: string };
  // Speaks the banner when it appears, for news that arrives without the person asking, such as
  // a failed refresh. Leave off for banners that are part of the screen from the start.
  announce?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

interface ToneStyle {
  background: keyof ColourTokens;
  text: TextTone;
  foreground: keyof ColourTokens;
  symbol: SFSymbol;
  // Spoken before the text, because the icon and colour alone do not say what kind of notice it is.
  spokenKind: string;
}

const TONES: Readonly<Record<BannerTone, ToneStyle>> = {
  info: {
    background: 'infoSoft',
    text: 'onInfoSoft',
    foreground: 'onInfoSoft',
    symbol: 'info.circle.fill',
    spokenKind: 'Information',
  },
  warning: {
    background: 'warningSoft',
    text: 'onWarningSoft',
    foreground: 'onWarningSoft',
    symbol: 'exclamationmark.triangle.fill',
    spokenKind: 'Warning',
  },
  error: {
    background: 'dangerSoft',
    text: 'onDangerSoft',
    foreground: 'onDangerSoft',
    symbol: 'xmark.octagon.fill',
    spokenKind: 'Error',
  },
  demo: {
    background: 'demo',
    text: 'onDemo',
    foreground: 'onDemo',
    symbol: 'testtube.2',
    spokenKind: 'Demo',
  },
};

export function bannerAccessibilityLabel(
  tone: BannerTone,
  title: string | undefined,
  message: string,
) {
  return [TONES[tone].spokenKind, title, message].filter(Boolean).join('. ');
}

export function Banner({
  tone,
  title,
  message,
  spokenMessage,
  action,
  announce = false,
  style: containerStyle,
  testID,
}: BannerProps) {
  const { colours } = useTheme();
  const style = TONES[tone];
  const spoken = bannerAccessibilityLabel(tone, title, spokenMessage ?? message);

  useEffect(() => {
    if (announce) AccessibilityInfo.announceForAccessibility(spoken);
  }, [announce, spoken]);

  return (
    <View
      testID={testID}
      style={[styles.banner, { backgroundColor: colours[style.background] }, containerStyle]}>
      <View accessible accessibilityLabel={spoken} style={styles.body}>
        <SymbolView name={style.symbol} tintColor={colours[style.foreground]} size={20} />
        <View style={styles.texts}>
          {title ? (
            <AppText variant="headline" tone={style.text}>
              {title}
            </AppText>
          ) : null}
          <AppText variant="subheadline" tone={style.text}>
            {message}
          </AppText>
        </View>
      </View>
      {action ? (
        <View style={styles.action}>
          <Button
            variant="plain"
            labelTone={style.text}
            label={action.label}
            onPress={action.onPress}
            accessibilityHint={action.accessibilityHint}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderRadius: RADII.lg,
    padding: SPACING.md,
    gap: SPACING.xs,
  },
  body: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
  },
  texts: {
    flex: 1,
    gap: SPACING.xxs,
  },
  action: {
    alignItems: 'flex-end',
  },
});
