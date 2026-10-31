// Spacing on a 4-point grid.
export const SPACING = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const RADII = {
  sm: 8,
  md: 14,
  lg: 22,
  xl: 28,
  pill: 999,
} as const;

// Apple's minimum comfortable target. Every interactive component is at least this big, and
// grows past it when Dynamic Type makes its text larger.
export const MIN_TOUCH_TARGET = 44;

export const PAGE_GUTTER = 20;

// Readable line length on wide windows (iPhone Mirroring and resizable windows on iOS 27).
export const MAX_CONTENT_WIDTH = 640;

export const HAIRLINE = 1;

// From this text size on (AX1 and up), side-by-side layouts stack so words are not split.
export const STACKED_LAYOUT_FONT_SCALE = 1.35;
