import { contrastRatio } from '@/test-support/contrast';

import { type ColourTokens, darkColours, lightColours } from './colours';
import { type LegVisualKind, MODE_COLOURS, ON_MODE_COLOUR } from './modes';

const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

type Pair = [foreground: keyof ColourTokens, background: keyof ColourTokens];

// Every foreground and background the components actually combine.
const TEXT_PAIRS: Pair[] = [
  ['text', 'background'],
  ['text', 'surface'],
  ['text', 'surfaceMuted'],
  ['textSecondary', 'background'],
  ['textSecondary', 'surface'],
  ['textSecondary', 'surfaceMuted'],
  ['brand', 'background'],
  ['brand', 'surface'],
  ['onBrand', 'brand'],
  ['onBrandSoft', 'brandSoft'],
  ['danger', 'background'],
  ['danger', 'surface'],
  ['onDanger', 'danger'],
  ['onDangerSoft', 'dangerSoft'],
  ['onWarningSoft', 'warningSoft'],
  ['onInfoSoft', 'infoSoft'],
  ['onSuccessSoft', 'successSoft'],
  ['onDemo', 'demo'],
  ['onMarker', 'markerFill'],
];

const CONTROL_BOUNDARY_PAIRS: Pair[] = [
  ['border', 'surface'],
  ['border', 'background'],
  ['brand', 'brandSoft'],
];

describe.each([
  ['light', lightColours],
  ['dark', darkColours],
] as const)('%s colours', (scheme, colours) => {
  it.each(TEXT_PAIRS)('%s on %s meets WCAG AA for body text', (foreground, background) => {
    expect(contrastRatio(colours[foreground], colours[background])).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(CONTROL_BOUNDARY_PAIRS)(
    '%s against %s meets the 3:1 control boundary minimum',
    (foreground, background) => {
      expect(contrastRatio(colours[foreground], colours[background])).toBeGreaterThanOrEqual(
        AA_NON_TEXT,
      );
    },
  );

  const modes = Object.keys(MODE_COLOURS[scheme]) as LegVisualKind[];

  it.each(modes)('the %s colour reads as text on surfaces and the background', (mode) => {
    const colour = MODE_COLOURS[scheme][mode];
    expect(contrastRatio(colour, colours.surface)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(colour, colours.background)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(modes)('text drawn on the %s colour meets WCAG AA', (mode) => {
    expect(
      contrastRatio(ON_MODE_COLOUR[scheme], MODE_COLOURS[scheme][mode]),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe('contrastRatio', () => {
  it('matches the WCAG reference values for black and white', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
  });
});
