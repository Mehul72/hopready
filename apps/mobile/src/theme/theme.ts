import { DarkTheme, DefaultTheme, type Theme as NavigationTheme } from 'expo-router';

import { type ColourScheme, useColourScheme } from './colour-scheme';
import { type ColourTokens, darkColours, lightColours } from './colours';
import { type LegVisualKind, MODE_COLOURS, ON_MODE_COLOUR } from './modes';

export interface Theme {
  scheme: ColourScheme;
  colours: ColourTokens;
  modeColours: Readonly<Record<LegVisualKind, string>>;
  onModeColour: string;
}

// Built once so components get the same object on every render and memoised children stay put.
export const THEMES: Readonly<Record<ColourScheme, Theme>> = {
  light: {
    scheme: 'light',
    colours: lightColours,
    modeColours: MODE_COLOURS.light,
    onModeColour: ON_MODE_COLOUR.light,
  },
  dark: {
    scheme: 'dark',
    colours: darkColours,
    modeColours: MODE_COLOURS.dark,
    onModeColour: ON_MODE_COLOUR.dark,
  },
};

export function useTheme(): Theme {
  return THEMES[useColourScheme()];
}

function toNavigationTheme(theme: Theme, base: NavigationTheme): NavigationTheme {
  return {
    ...base,
    dark: theme.scheme === 'dark',
    colors: {
      primary: theme.colours.brand,
      background: theme.colours.background,
      card: theme.colours.surface,
      text: theme.colours.text,
      border: theme.colours.separator,
      notification: theme.colours.danger,
    },
  };
}

// Native headers and tab bars read these, so they match the rest of the app in both appearances.
export const NAVIGATION_THEMES: Readonly<Record<ColourScheme, NavigationTheme>> = {
  light: toNavigationTheme(THEMES.light, DefaultTheme),
  dark: toNavigationTheme(THEMES.dark, DarkTheme),
};
