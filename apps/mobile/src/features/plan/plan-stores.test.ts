import { DEMO_PLACES } from '@hopready/core/fixtures';

import { appStorage } from '@/storage';
import { createMemoryBackend } from '@/test-support/memory-kv-store';

import {
  createPlanChoicesStore,
  DEFAULT_PLAN_CHOICES,
  planChoices,
  planChoicesInForce,
} from './plan-choices';
import { createPlanDraftStore, planDraft } from './plan-draft';

const NOW = new Date('2026-10-26T20:32:00.000Z');

beforeEach(() => {
  appStorage.deleteAllData();
});

describe('the plan draft', () => {
  it('swaps places and keeps a picked time when switching between depart and arrive', () => {
    const draft = createPlanDraftStore();
    draft.setRoute(DEMO_PLACES.rouseHillHome, DEMO_PLACES.barangarooOffice);
    draft.swapPlaces();
    expect(draft.getState()).toMatchObject({
      origin: DEMO_PLACES.barangarooOffice,
      destination: DEMO_PLACES.rouseHillHome,
    });

    draft.setTimeType('depart', NOW);
    draft.setChosenTime('2026-10-26T23:00:00.000Z');
    draft.setTimeType('arrive', NOW);
    expect(draft.getState().time).toEqual({ type: 'arrive', at: '2026-10-26T23:00:00.000Z' });
  });

  it('ignores a picked time while "Leave now" is chosen', () => {
    const draft = createPlanDraftStore();
    draft.setChosenTime('2026-10-26T23:00:00.000Z');
    expect(draft.getState().time).toEqual({ type: 'now' });
  });

  it('tells subscribers about changes, and stops when they unsubscribe', () => {
    const draft = createPlanDraftStore();
    const listener = jest.fn();
    const unsubscribe = draft.subscribe(listener);
    draft.setPlace('origin', DEMO_PLACES.rouseHillHome);
    unsubscribe();
    draft.setPlace('destination', DEMO_PLACES.barangarooOffice);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('is cleared with everything else when the person deletes all data', () => {
    planDraft.setRoute(DEMO_PLACES.rouseHillHome, DEMO_PLACES.barangarooOffice);
    appStorage.deleteAllData();
    expect(planDraft.getState()).toEqual({
      origin: null,
      destination: null,
      time: { type: 'now' },
    });
  });
});

describe('saved plan choices', () => {
  it('starts with public transport and driving on', () => {
    expect(planChoices.get()).toEqual(DEFAULT_PLAN_CHOICES);
  });

  it('remembers choices across launches', () => {
    const backend = createMemoryBackend();
    const firstLaunch = createPlanChoicesStore(backend, () => () => undefined);
    firstLaunch.setAccess({ drive: false, dropOff: true });
    firstLaunch.setPreferredCarPark({ id: '29', name: 'Kellyville (north)', kind: 'car-park' });

    const nextLaunch = createPlanChoicesStore(backend, () => () => undefined);
    expect(nextLaunch.get()).toEqual({
      access: { transit: true, drive: false, dropOff: true },
      preferredStation: null,
      preferredCarPark: { id: '29', name: 'Kellyville (north)', kind: 'car-park' },
    });
  });

  it('keeps a preferred car park saved before parking spots could be preferred', () => {
    const backend = createMemoryBackend({
      'hopready.plan-choices.v1': JSON.stringify({
        access: { transit: true, drive: false, dropOff: true },
        preferredStation: null,
        preferredCarPark: { id: '29', name: 'Kellyville (north)' },
      }),
    });
    const store = createPlanChoicesStore(backend, () => () => undefined);
    expect(store.get()).toEqual({
      access: { transit: true, drive: false, dropOff: true },
      preferredStation: null,
      preferredCarPark: { id: '29', name: 'Kellyville (north)', kind: 'car-park' },
    });
  });

  it('stops preferring a parking spot once it is deleted, but never a car park', () => {
    const added = appStorage.parkingSpots.add('Street spot', { lat: -33.6925, lon: 150.9235 });
    if (added.status !== 'added') throw new Error('The parking spot was not saved');
    const spot = { id: added.item.id, name: 'Street spot', kind: 'saved-spot' as const };
    planChoices.setPreferredCarPark(spot);
    expect(planChoicesInForce().preferredCarPark).toEqual(spot);

    appStorage.parkingSpots.remove(spot.id);
    expect(planChoicesInForce().preferredCarPark).toBeNull();

    planChoices.setPreferredCarPark({ id: '29', name: 'Kellyville (north)', kind: 'car-park' });
    expect(planChoicesInForce().preferredCarPark).toMatchObject({ id: '29' });
  });

  it('falls back to the defaults when the saved value cannot be read', () => {
    const backend = createMemoryBackend({ 'hopready.plan-choices.v1': '{"access":"everything"}' });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = createPlanChoicesStore(backend, () => () => undefined);
    expect(store.get()).toEqual(DEFAULT_PLAN_CHOICES);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('plan-choices'));
  });

  it('is removed when the person deletes all data', () => {
    planChoices.setPreferredStation(DEMO_PLACES.castleTowers);
    appStorage.deleteAllData();
    expect(planChoices.get()).toEqual(DEFAULT_PLAN_CHOICES);
  });
});
