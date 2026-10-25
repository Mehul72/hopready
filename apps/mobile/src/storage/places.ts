import type { Place } from '@hopready/core';

import type { KeyValueBackend } from './backend';
import { type AddResult, isSamePlace, replaceById } from './collections';
import {
  type FavouritePlace,
  MAX_FAVOURITE_PLACES,
  type SavedPlaces,
  savedPlacesSchema,
} from './schemas';
import { createStoredValue, type ManagedStoredValue } from './stored-value';

export interface PlacesStore extends ManagedStoredValue<SavedPlaces> {
  setHome: (place: Place | null) => void;
  setWork: (place: Place | null) => void;
  addFavourite: (label: string, place: Place) => AddResult<FavouritePlace>;
  // Both return false when the favourite no longer exists, for example after deleting all data.
  renameFavourite: (id: string, label: string) => boolean;
  removeFavourite: (id: string) => boolean;
}

export function createPlacesStore(backend: KeyValueBackend, createId: () => string): PlacesStore {
  const stored = createStoredValue(backend, {
    name: 'places',
    version: 1,
    schema: savedPlacesSchema,
    defaultValue: (): SavedPlaces => ({ home: null, work: null, favourites: [] }),
  });

  return {
    ...stored,
    setHome: (place) => {
      stored.update((current) => ({ ...current, home: place }));
    },
    setWork: (place) => {
      stored.update((current) => ({ ...current, work: place }));
    },
    addFavourite: (label, place) => {
      const current = stored.get();
      const existing = current.favourites.find((favourite) => isSamePlace(favourite.place, place));
      if (existing) return { status: 'already-saved', item: existing };
      if (current.favourites.length >= MAX_FAVOURITE_PLACES) {
        return { status: 'limit-reached', limit: MAX_FAVOURITE_PLACES };
      }
      const item: FavouritePlace = { id: createId(), label: label.trim(), place };
      stored.set({ ...current, favourites: [...current.favourites, item] });
      return { status: 'added', item };
    },
    renameFavourite: (id, label) => {
      const current = stored.get();
      const favourites = replaceById(current.favourites, id, (favourite) => ({
        ...favourite,
        label: label.trim(),
      }));
      if (!favourites) return false;
      stored.set({ ...current, favourites });
      return true;
    },
    removeFavourite: (id) => {
      const current = stored.get();
      const favourites = current.favourites.filter((favourite) => favourite.id !== id);
      if (favourites.length === current.favourites.length) return false;
      stored.set({ ...current, favourites });
      return true;
    },
  };
}
