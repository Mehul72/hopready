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
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 999,
} as const;

// Apple's minimum comfortable target. Every interactive component is at least this big, and
// grows past it when Dynamic Type makes its text larger.
export const MIN_TOUCH_TARGET = 44;

// Readable line length on wide windows (iPhone Mirroring and resizable windows on iOS 27).
export const MAX_CONTENT_WIDTH = 640;

export const HAIRLINE = 1;
