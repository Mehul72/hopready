import type { Place } from '@hopready/core';
import { useSyncExternalStore } from 'react';

import { appStorage } from '@/storage';

import { changeTimeType, type TimeChoice, type TimeType } from './time-choice';

export type PlaceField = 'origin' | 'destination';

// The trip being put together on the Plan tab. The place search and trip options sheets write
// into it, so it lives outside any one screen. It is not saved: recents keep past trips.
export interface PlanDraft {
  origin: Place | null;
  destination: Place | null;
  time: TimeChoice;
}

export interface PlanDraftStore {
  getState: () => PlanDraft;
  subscribe: (listener: () => void) => () => void;
  setPlace: (field: PlaceField, place: Place | null) => void;
  swapPlaces: () => void;
  setRoute: (origin: Place | null, destination: Place | null) => void;
  setTimeType: (type: TimeType, now: Date) => void;
  setChosenTime: (at: string) => void;
  reset: () => void;
}

const EMPTY_DRAFT: PlanDraft = { origin: null, destination: null, time: { type: 'now' } };

export function createPlanDraftStore(): PlanDraftStore {
  let state = EMPTY_DRAFT;
  const listeners = new Set<() => void>();

  function update(next: PlanDraft) {
    state = next;
    for (const listener of [...listeners]) listener();
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setPlace: (field, place) => update({ ...state, [field]: place }),
    swapPlaces: () => update({ ...state, origin: state.destination, destination: state.origin }),
    setRoute: (origin, destination) => update({ ...state, origin, destination }),
    setTimeType: (type, now) => {
      if (type === state.time.type) return;
      update({ ...state, time: changeTimeType(state.time, type, now) });
    },
    setChosenTime: (at) => {
      if (state.time.type === 'now') return;
      update({ ...state, time: { type: state.time.type, at } });
    },
    reset: () => update(EMPTY_DRAFT),
  };
}

export const planDraft = createPlanDraftStore();

// The draft holds places the person chose, so "Delete all data" clears it with everything else.
appStorage.onDataDeleted(() => planDraft.reset());

export function usePlanDraft(): PlanDraft {
  return useSyncExternalStore(planDraft.subscribe, planDraft.getState, planDraft.getState);
}
