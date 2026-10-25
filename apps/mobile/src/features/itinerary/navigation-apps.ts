import type { Coordinate } from '@hopready/core';

import type { NavigationApp } from '@/storage';

import { errorName } from '../saved/storage-writes';

export type NavigationAppId = Exclude<NavigationApp, 'ask'>;

export const NAVIGATION_APP_NAMES: Readonly<Record<NavigationAppId, string>> = {
  apple: 'Apple Maps',
  google: 'Google Maps',
  waze: 'Waze',
};

// Apple Maps always opens: if the app was removed, maps.apple.com opens on the web instead. The
// others are offered only when iOS reports them installed, which needs their schemes listed in
// LSApplicationQueriesSchemes (app.config.ts); without that, canOpenURL always says no.
const INSTALL_CHECK_URLS: Readonly<Record<Exclude<NavigationAppId, 'apple'>, string>> = {
  google: 'comgooglemaps://',
  waze: 'waze://',
};

// Apple documents the unified Maps URLs (maps.apple.com/directions) from iOS 18.4. Earlier
// versions get the older daddr form, which every supported iOS version understands.
const UNIFIED_MAPS_URLS_SINCE = { major: 18, minor: 4 };
const COORDINATE_DECIMALS = 6;

function supportsUnifiedMapsUrls(iosVersion: string | number | undefined): boolean {
  const match = /^(\d+)(?:\.(\d+))?/.exec(String(iosVersion ?? ''));
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2] ?? '0');
  return (
    major > UNIFIED_MAPS_URLS_SINCE.major ||
    (major === UNIFIED_MAPS_URLS_SINCE.major && minor >= UNIFIED_MAPS_URLS_SINCE.minor)
  );
}

function coordinateText(coordinate: Coordinate): string {
  return `${coordinate.lat.toFixed(COORDINATE_DECIMALS)},${coordinate.lon.toFixed(COORDINATE_DECIMALS)}`;
}

export function drivingDirectionsUrl(
  app: NavigationAppId,
  destination: Coordinate,
  iosVersion: string | number | undefined,
): string {
  const target = coordinateText(destination);
  switch (app) {
    case 'apple':
      return supportsUnifiedMapsUrls(iosVersion)
        ? `https://maps.apple.com/directions?destination=${target}&mode=driving`
        : `https://maps.apple.com/?daddr=${target}&dirflg=d`;
    case 'google':
      return `comgooglemaps://?daddr=${target}&directionsmode=driving`;
    case 'waze':
      return `https://waze.com/ul?ll=${target}&navigate=yes`;
  }
}

// Apple Maps first, then the other apps iOS says are installed. A failed check counts as not
// installed: offering an app that may not open is worse than leaving it out.
export async function findInstalledNavigationApps(
  canOpenURL: (url: string) => Promise<boolean>,
): Promise<NavigationAppId[]> {
  const optionalApps = ['google', 'waze'] as const;
  const installed = await Promise.all(
    optionalApps.map(async (app) => {
      try {
        return (await canOpenURL(INSTALL_CHECK_URLS[app])) ? app : null;
      } catch (error) {
        console.warn(
          `HopReady: could not check whether ${NAVIGATION_APP_NAMES[app]} is installed (${errorName(error)}).`,
        );
        return null;
      }
    }),
  );
  return ['apple', ...installed.filter((app) => app !== null)];
}

export type NavigationLaunch =
  { kind: 'open'; app: NavigationAppId } | { kind: 'choose'; apps: NavigationAppId[] };

// The saved preference opens its app straight away when it is installed. "Ask every time", or a
// preferred app that is not installed, shows the installed apps to choose from, unless there is
// only one.
export function planNavigationLaunch(
  preference: NavigationApp,
  installed: readonly NavigationAppId[],
): NavigationLaunch {
  if (preference !== 'ask' && installed.includes(preference)) {
    return { kind: 'open', app: preference };
  }
  const [only] = installed;
  if (installed.length === 1 && only) return { kind: 'open', app: only };
  return { kind: 'choose', apps: [...installed] };
}
