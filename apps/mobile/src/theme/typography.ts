import type { TextProps, TextStyle } from 'react-native';

// iOS text styles at the default ("Large") content size. Text scales with the user's Dynamic Type
// setting through each style's own ramp, the way UIKit scales the matching UIFont.TextStyle.
export type TextVariant =
  | 'largeTitle'
  | 'title1'
  | 'title2'
  | 'title3'
  | 'headline'
  | 'body'
  | 'callout'
  | 'subheadline'
  | 'footnote'
  | 'caption';

type DynamicTypeRamp = NonNullable<TextProps['dynamicTypeRamp']>;

export interface TextVariantStyle {
  fontSize: number;
  lineHeight: number;
  fontWeight: NonNullable<TextStyle['fontWeight']>;
  dynamicTypeRamp: DynamicTypeRamp;
}

export const TEXT_VARIANTS: Readonly<Record<TextVariant, TextVariantStyle>> = {
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: '700', dynamicTypeRamp: 'largeTitle' },
  title1: { fontSize: 28, lineHeight: 34, fontWeight: '700', dynamicTypeRamp: 'title1' },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: '700', dynamicTypeRamp: 'title2' },
  title3: { fontSize: 20, lineHeight: 25, fontWeight: '600', dynamicTypeRamp: 'title3' },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600', dynamicTypeRamp: 'headline' },
  body: { fontSize: 17, lineHeight: 22, fontWeight: '400', dynamicTypeRamp: 'body' },
  callout: { fontSize: 16, lineHeight: 21, fontWeight: '400', dynamicTypeRamp: 'callout' },
  subheadline: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '400',
    dynamicTypeRamp: 'subheadline',
  },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400', dynamicTypeRamp: 'footnote' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400', dynamicTypeRamp: 'caption1' },
};

// Times and durations line up in lists when every digit has the same width.
export const TABULAR_NUMBERS: TextStyle = { fontVariant: ['tabular-nums'] };

// Small fixed-height pills (badges, chips) stop growing here; their text still scales up to
// 1.6 times, and the screen around them keeps scaling fully.
export const COMPACT_MAX_FONT_SCALE = 1.6;
