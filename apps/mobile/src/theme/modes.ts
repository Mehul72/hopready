import type { Leg, TransitMode } from '@hopready/core';
import type { SFSymbol } from 'expo-symbols';

import type { ColourScheme } from './colour-scheme';

export type TravelMode = TransitMode | 'walk' | 'drive' | 'ride';
// Legs where the traveller stays in one place.
export type StopActivity = 'park' | 'drop-off' | 'wait' | 'car-retrieval';
export type LegVisualKind = TravelMode | StopActivity;

export interface LegVisual {
  // Spoken and shown next to the icon, so a mode is never told apart by colour alone.
  label: string;
  symbol: SFSymbol;
}

export const LEG_VISUALS: Readonly<Record<LegVisualKind, LegVisual>> = {
  train: { label: 'Train', symbol: 'train.side.front.car' },
  metro: { label: 'Metro', symbol: 'tram.fill.tunnel' },
  'light-rail': { label: 'Light rail', symbol: 'tram.fill' },
  bus: { label: 'Bus', symbol: 'bus.fill' },
  'school-bus': { label: 'School bus', symbol: 'bus.fill' },
  coach: { label: 'Coach', symbol: 'bus.doubledecker.fill' },
  ferry: { label: 'Ferry', symbol: 'ferry.fill' },
  'on-demand': { label: 'On demand', symbol: 'iphone.radiowaves.left.and.right' },
  other: { label: 'Other service', symbol: 'circle.dashed' },
  walk: { label: 'Walk', symbol: 'figure.walk' },
  drive: { label: 'Drive', symbol: 'car.fill' },
  ride: { label: 'Ride', symbol: 'car.side.fill' },
  park: { label: 'Park', symbol: 'parkingsign.circle.fill' },
  'drop-off': { label: 'Drop-off', symbol: 'figure.wave' },
  wait: { label: 'Wait', symbol: 'clock' },
  'car-retrieval': { label: 'Back to your car', symbol: 'key.fill' },
};

// Original hues that follow common Sydney associations (amber trains, red light rail) without
// reusing Transport for NSW's published colours. Light-scheme values reach 4.5:1 on white and
// dark-scheme values reach 4.5:1 on the dark surface, so they also work as text and map lines.
const LIGHT_MODE_COLOURS: Readonly<Record<LegVisualKind, string>> = {
  train: '#B45309',
  metro: '#00718A',
  'light-rail': '#C0262D',
  bus: '#2251B8',
  'school-bus': '#2251B8',
  coach: '#7A3E96',
  ferry: '#2D7A33',
  'on-demand': '#A8235F',
  other: '#5E6573',
  walk: '#5E6573',
  drive: '#334155',
  ride: '#7A5230',
  park: '#334155',
  'drop-off': '#7A5230',
  wait: '#5E6573',
  'car-retrieval': '#334155',
};

const DARK_MODE_COLOURS: Readonly<Record<LegVisualKind, string>> = {
  train: '#FFA552',
  metro: '#5CC6E0',
  'light-rail': '#FF8A8A',
  bus: '#8DB4FF',
  'school-bus': '#8DB4FF',
  coach: '#D9A2F2',
  ferry: '#86D68A',
  'on-demand': '#FF8BBE',
  other: '#AEB5C1',
  walk: '#AEB5C1',
  drive: '#B6C2D1',
  ride: '#D9B48E',
  park: '#B6C2D1',
  'drop-off': '#D9B48E',
  wait: '#AEB5C1',
  'car-retrieval': '#B6C2D1',
};

export const MODE_COLOURS: Readonly<Record<ColourScheme, Readonly<Record<LegVisualKind, string>>>> =
  {
    light: LIGHT_MODE_COLOURS,
    dark: DARK_MODE_COLOURS,
  };

// Text or glyphs drawn on top of a mode colour, such as a route number badge.
export const ON_MODE_COLOUR: Readonly<Record<ColourScheme, string>> = {
  light: '#FFFFFF',
  dark: '#0E1013',
};

export function legVisualKind(leg: Leg): LegVisualKind {
  switch (leg.kind) {
    case 'transit':
      return leg.mode;
    case 'walk':
    case 'drive':
    case 'ride':
    case 'park':
    case 'drop-off':
    case 'wait':
    case 'car-retrieval':
      return leg.kind;
  }
}

export function isTravelMode(kind: LegVisualKind): kind is TravelMode {
  return kind !== 'park' && kind !== 'drop-off' && kind !== 'wait' && kind !== 'car-retrieval';
}
