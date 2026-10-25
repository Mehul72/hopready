import { Text, type TextProps } from 'react-native';

import {
  type ColourTokens,
  TABULAR_NUMBERS,
  TEXT_VARIANTS,
  type TextVariant,
  useTheme,
} from '@/theme';

// Each tone names the surface it is meant for, so every pairing keeps WCAG AA contrast:
// 'primary' and 'secondary' on background, surface or surfaceMuted; 'onBrand' on brand; and so on.
export type TextTone =
  | 'primary'
  | 'secondary'
  | 'brand'
  | 'danger'
  | 'onBrand'
  | 'onBrandSoft'
  | 'onDanger'
  | 'onDangerSoft'
  | 'onWarningSoft'
  | 'onInfoSoft'
  | 'onSuccessSoft'
  | 'onDemo';

const TONE_COLOUR: Readonly<Record<TextTone, keyof ColourTokens>> = {
  primary: 'text',
  secondary: 'textSecondary',
  brand: 'brand',
  danger: 'danger',
  onBrand: 'onBrand',
  onBrandSoft: 'onBrandSoft',
  onDanger: 'onDanger',
  onDangerSoft: 'onDangerSoft',
  onWarningSoft: 'onWarningSoft',
  onInfoSoft: 'onInfoSoft',
  onSuccessSoft: 'onSuccessSoft',
  onDemo: 'onDemo',
};

export function colourForTone(colours: ColourTokens, tone: TextTone): string {
  return colours[TONE_COLOUR[tone]];
}

const WEIGHTS = { regular: '400', medium: '500', semibold: '600', bold: '700' } as const;

export interface AppTextProps extends TextProps {
  variant?: TextVariant;
  tone?: TextTone;
  // Overrides the variant's weight, for emphasis inside a sentence or a row.
  weight?: keyof typeof WEIGHTS;
  // For times, durations and counts, so digits line up from row to row.
  tabularNumbers?: boolean;
  align?: 'auto' | 'left' | 'center' | 'right';
  // A colour that is not a tone, such as a transport mode colour that meets contrast on surfaces.
  colour?: string;
}

// All text in the app. It scales with Dynamic Type through the matching iOS text style ramp.
export function AppText({
  variant = 'body',
  tone = 'primary',
  weight,
  tabularNumbers = false,
  align,
  colour,
  style,
  ...textProps
}: AppTextProps) {
  const { colours } = useTheme();
  const { dynamicTypeRamp, ...variantStyle } = TEXT_VARIANTS[variant];
  return (
    <Text
      dynamicTypeRamp={dynamicTypeRamp}
      style={[
        variantStyle,
        { color: colour ?? colourForTone(colours, tone) },
        weight ? { fontWeight: WEIGHTS[weight] } : null,
        tabularNumbers ? TABULAR_NUMBERS : null,
        align ? { textAlign: align } : null,
        style,
      ]}
      {...textProps}
    />
  );
}
