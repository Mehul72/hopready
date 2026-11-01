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
export const BRAND_COLOUR = '#1C1C1C';
export const BRAND_COLOUR_DARK_BACKGROUND = '#000000';

export const lightColours: ColourTokens = {
  background: '#F5F5F5',
  surface: '#FFFFFF',
  surfaceMuted: '#EBEBEB',
  separator: '#DCDCDC',
  border: '#808080',
  text: '#1C1C1C',
  textSecondary: '#5C5C5C',
  brand: BRAND_COLOUR,
  onBrand: '#FFFFFF',
  brandSoft: '#EBEBEB',
  onBrandSoft: '#242424',
  danger: '#B42318',
  onDanger: '#FFFFFF',
  dangerSoft: '#FDECEA',
  onDangerSoft: '#8A1C12',
  warningSoft: '#FFF3D1',
  onWarningSoft: '#6B4400',
  infoSoft: '#EBEBEB',
  onInfoSoft: '#383838',
  successSoft: '#E2F2E6',
  onSuccessSoft: '#1C5E31',
  demo: '#383838',
  onDemo: '#FFFFFF',
  skeleton: '#E3E3E3',
  markerFill: BRAND_COLOUR,
  onMarker: '#FFFFFF',
  markerRing: '#FFFFFF',
};

export const darkColours: ColourTokens = {
  background: '#000000',
  surface: '#1C1C1C',
  surfaceMuted: '#2C2C2C',
  separator: '#383838',
  border: '#8E8E8E',
  text: '#F5F5F5',
  textSecondary: '#B8B8B8',
  brand: '#F5F5F5',
  onBrand: '#111111',
  brandSoft: '#2C2C2C',
  onBrandSoft: '#F2F2F2',
  danger: '#FFB4A9',
  onDanger: '#5C120B',
  dangerSoft: '#3D1714',
  onDangerSoft: '#FFC9C1',
  warningSoft: '#3A2E0C',
  onWarningSoft: '#FFD88A',
  infoSoft: '#2C2C2C',
  onInfoSoft: '#E5E5E5',
  successSoft: '#15321F',
  onSuccessSoft: '#AEE3BC',
  demo: '#E5E5E5',
  onDemo: '#242424',
  skeleton: '#303030',
  markerFill: '#F5F5F5',
  onMarker: '#111111',
  markerRing: '#1C1C1C',
};
