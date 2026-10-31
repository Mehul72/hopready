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
export const BRAND_COLOUR = '#2557D6';
export const BRAND_COLOUR_DARK_BACKGROUND = '#13285B';

export const lightColours: ColourTokens = {
  background: '#F4F6FA',
  surface: '#FFFFFF',
  surfaceMuted: '#EBEFF5',
  separator: '#DFE5EE',
  border: '#7C879B',
  text: '#172234',
  textSecondary: '#526078',
  brand: BRAND_COLOUR,
  onBrand: '#FFFFFF',
  brandSoft: '#EAF0FF',
  onBrandSoft: '#2048AD',
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
  demo: '#29354C',
  onDemo: '#FFFFFF',
  skeleton: '#E4E7EC',
  markerFill: BRAND_COLOUR,
  onMarker: '#FFFFFF',
  markerRing: '#FFFFFF',
};

export const darkColours: ColourTokens = {
  background: '#0D1421',
  surface: '#172235',
  surfaceMuted: '#223047',
  separator: '#2D3C54',
  border: '#8190A8',
  text: '#F1F5FC',
  textSecondary: '#B4C1D5',
  brand: '#A8C1FF',
  onBrand: '#112652',
  brandSoft: '#233960',
  onBrandSoft: '#CCDCFF',
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
  demo: '#D8E4FC',
  onDemo: '#172744',
  skeleton: '#2A2F37',
  markerFill: '#A8C1FF',
  onMarker: '#112652',
  markerRing: '#172235',
};
