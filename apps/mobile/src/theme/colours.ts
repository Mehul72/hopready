// Colour tokens for light and dark appearance. Every text and icon colour meets WCAG AA (4.5:1)
// against the surfaces it is paired with; contrast.test.ts fails the build if one drifts.

export interface ColourTokens {
  // Screen background behind grouped content.
  background: string;
  // Cards, rows and sheets that sit on the background.
  surface: string;
  // Tracks, skeletons and pressed rows.
  surfaceMuted: string;
  // Hairlines between rows. Decorative only, never the only sign of a boundary.
  separator: string;
  // Control outlines: at least 3:1 against surface and background (WCAG 1.4.11).
  border: string;
  text: string;
  textSecondary: string;
  // HopReady's own colour: primary actions, links and selection. Never used for transport modes.
  brand: string;
  onBrand: string;
  brandSoft: string;
  onBrandSoft: string;
  danger: string;
  onDanger: string;
  dangerSoft: string;
  onDangerSoft: string;
  warningSoft: string;
  onWarningSoft: string;
  infoSoft: string;
  onInfoSoft: string;
  successSoft: string;
  onSuccessSoft: string;
  // The demo banner must not look like any real status, so it gets its own high-contrast pair.
  demo: string;
  onDemo: string;
  skeleton: string;
  // Map markers sit on a busy map, so they use a solid fill with a light ring.
  markerFill: string;
  onMarker: string;
  markerRing: string;
}

// The calm deep teal of the HopReady icon (apps/mobile/scripts/generate-brand-assets.mjs).
export const BRAND_COLOUR = '#0E6F6E';
export const BRAND_COLOUR_DARK_BACKGROUND = '#0B3B3A';

export const lightColours: ColourTokens = {
  background: '#F3F4F7',
  surface: '#FFFFFF',
  surfaceMuted: '#E9ECF1',
  separator: '#DDE1E7',
  border: '#7D8594',
  text: '#14171C',
  textSecondary: '#4B5260',
  brand: BRAND_COLOUR,
  onBrand: '#FFFFFF',
  brandSoft: '#DDF0EF',
  onBrandSoft: '#0A4F4E',
  danger: '#B42318',
  onDanger: '#FFFFFF',
  dangerSoft: '#FDECEA',
  onDangerSoft: '#8A1C12',
  warningSoft: '#FFF3D1',
  onWarningSoft: '#6B4400',
  infoSoft: '#E3EEF9',
  onInfoSoft: '#0D4377',
  successSoft: '#E2F2E6',
  onSuccessSoft: '#1C5E31',
  demo: '#2B2840',
  onDemo: '#FFFFFF',
  skeleton: '#E4E7EC',
  markerFill: '#14171C',
  onMarker: '#FFFFFF',
  markerRing: '#FFFFFF',
};

export const darkColours: ColourTokens = {
  background: '#0E1013',
  surface: '#181B20',
  surfaceMuted: '#23272E',
  separator: '#2E333C',
  border: '#7A8291',
  text: '#F1F3F6',
  textSecondary: '#B3B9C4',
  brand: '#5FCFC9',
  onBrand: '#04302F',
  brandSoft: '#173B3A',
  onBrandSoft: '#BDEBE8',
  danger: '#FFB4A9',
  onDanger: '#5C120B',
  dangerSoft: '#3D1714',
  onDangerSoft: '#FFC9C1',
  warningSoft: '#3A2E0C',
  onWarningSoft: '#FFD88A',
  infoSoft: '#132E4A',
  onInfoSoft: '#B5D6F7',
  successSoft: '#15321F',
  onSuccessSoft: '#AEE3BC',
  demo: '#E6E1FF',
  onDemo: '#1D1838',
  skeleton: '#2A2F37',
  markerFill: '#F1F3F6',
  onMarker: '#14171C',
  markerRing: '#14171C',
};
