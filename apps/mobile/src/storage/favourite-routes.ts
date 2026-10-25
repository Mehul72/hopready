import type { Place } from '@hopready/core';

import type { KeyValueBackend } from './backend';
import { type AddResult, isSamePlace, replaceById } from './collections';
import { type FavouriteRoute, favouriteRoutesSchema, MAX_FAVOURITE_ROUTES } from './schemas';
import { createStoredValue, type ManagedStoredValue } from './stored-value';

export interface FavouriteRoutesStore extends ManagedStoredValue<FavouriteRoute[]> {
  add: (route: { label: string; origin: Place; destination: Place }) => AddResult<FavouriteRoute>;
  rename: (id: string, label: string) => boolean;
  remove: (id: string) => boolean;
}

export function createFavouriteRoutesStore(
  backend: KeyValueBackend,
  createId: () => string,
): FavouriteRoutesStore {
  const stored = createStoredValue(backend, {
    name: 'favourite-routes',
    version: 1,
    schema: favouriteRoutesSchema,
    defaultValue: (): FavouriteRoute[] => [],
  });

  return {
    ...stored,
    add: ({ label, origin, destination }) => {
      const current = stored.get();
      const existing = current.find(
        (route) => isSamePlace(route.origin, origin) && isSamePlace(route.destination, destination),
      );
      if (existing) return { status: 'already-saved', item: existing };
      if (current.length >= MAX_FAVOURITE_ROUTES) {
        return { status: 'limit-reached', limit: MAX_FAVOURITE_ROUTES };
      }
      const item: FavouriteRoute = { id: createId(), label: label.trim(), origin, destination };
      stored.set([...current, item]);
      return { status: 'added', item };
    },
    rename: (id, label) => {
      const routes = replaceById(stored.get(), id, (route) => ({ ...route, label: label.trim() }));
      if (!routes) return false;
      stored.set(routes);
      return true;
    },
    remove: (id) => {
      const current = stored.get();
      const routes = current.filter((route) => route.id !== id);
      if (routes.length === current.length) return false;
      stored.set(routes);
      return true;
    },
  };
}
