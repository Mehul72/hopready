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

// Shared with the icon and launch screen (scripts/generate-brand-assets.mjs).
export const BRAND_COLOUR = '#3D6650';
export const BRAND_COLOUR_DARK_BACKGROUND = '#151614';

export const lightColours: ColourTokens = {
  background: '#F6F6F4',
  surface: '#FFFFFF',
  surfaceMuted: '#ECEDE9',
  separator: '#DFE1DB',
  border: '#7C837B',
  text: '#242823',
  textSecondary: '#596157',
  brand: BRAND_COLOUR,
  onBrand: '#FFFFFF',
  brandSoft: '#EEF2EB',
  onBrandSoft: '#31513F',
  danger: '#B42318',
  onDanger: '#FFFFFF',
  dangerSoft: '#FDECEA',
  onDangerSoft: '#8A1C12',
  warningSoft: '#FFF3D1',
  onWarningSoft: '#6B4400',
  infoSoft: '#EEF0EB',
  onInfoSoft: '#3D4C3E',
  successSoft: '#E2F2E6',
  onSuccessSoft: '#1C5E31',
  demo: '#34382F',
  onDemo: '#FFFFFF',
  skeleton: '#E3E5DE',
  markerFill: BRAND_COLOUR,
  onMarker: '#FFFFFF',
  markerRing: '#FFFFFF',
};

export const darkColours: ColourTokens = {
  background: '#151614',
  surface: '#20211E',
  surfaceMuted: '#2B2D28',
  separator: '#393C35',
  border: '#899184',
  text: '#F0F2EC',
  textSecondary: '#B8BEB2',
  brand: '#B8CBB9',
  onBrand: '#1B2B20',
  brandSoft: '#2E3B2F',
  onBrandSoft: '#DAE5D6',
  danger: '#FFB4A9',
  onDanger: '#5C120B',
  dangerSoft: '#3D1714',
  onDangerSoft: '#FFC9C1',
  warningSoft: '#3A2E0C',
  onWarningSoft: '#FFD88A',
  infoSoft: '#2B3029',
  onInfoSoft: '#D8E1D2',
  successSoft: '#15321F',
  onSuccessSoft: '#AEE3BC',
  demo: '#E4E8DF',
  onDemo: '#242B23',
  skeleton: '#30332C',
  markerFill: '#B8CBB9',
  onMarker: '#1B2B20',
  markerRing: '#20211E',
};
