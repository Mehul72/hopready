import { useColorScheme } from 'react-native';

export type ColourScheme = 'light' | 'dark';

// iOS reports 'unspecified' before the first trait collection arrives; light is the system default.
export function useColourScheme(): ColourScheme {
  return useColorScheme() === 'dark' ? 'dark' : 'light';
}
