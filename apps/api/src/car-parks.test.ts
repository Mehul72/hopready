import type { CarParkFacility, CarParkProvider } from '@hopready/core';
import { describe, expect, it } from 'vitest';

import { CarParkCatalogue } from './car-parks';
import { facility, testClock } from './test-support/fakes';

const TALLAWONG = facility('26', 'Tallawong P1', -33.6913, 150.9061);

function catalogueWith(answers: (() => Promise<CarParkFacility[]>)[]) {
  const clock = testClock();
  let calls = 0;
  const provider: CarParkProvider = {
    name: 'tfnsw-car-park',
    listFacilities: () => answers[Math.min(calls++, answers.length - 1)]!(),
    occupancy: async () => new Map(),
  };
  const catalogue = new CarParkCatalogue({
    clock,
    ttlMs: 60_000,
    timeoutMs: 50,
    onLateOutcome: () => undefined,
  });
  return { catalogue, provider, clock, calls: () => calls };
}

describe('CarParkCatalogue', () => {
  it('lets requests arriving together share one fetch', async () => {
    const { catalogue, provider, calls } = catalogueWith([async () => [TALLAWONG]]);
    const [first, second] = await Promise.all([catalogue.read(provider), catalogue.read(provider)]);
    expect(first.listing.carParks).toHaveLength(1);
    expect(second.listing.carParks).toHaveLength(1);
    expect(calls()).toBe(1);
  });

  it('gives up waiting on a fetch that never settles, answering a timeout', async () => {
    // On Workers a fetch lost with its request never settles, and neither does its timer.
    const { catalogue, provider } = catalogueWith([() => new Promise(() => undefined)]);
    await expect(catalogue.read(provider)).rejects.toMatchObject({
      provider: 'tfnsw-car-park',
      failure: 'timeout',
    });
  });

  it('starts a new fetch once the pending one is past the waiting limit', async () => {
    const { catalogue, provider, clock, calls } = catalogueWith([
      () => new Promise(() => undefined),
      async () => [TALLAWONG],
    ]);
    const lost = catalogue.read(provider).catch((error: unknown) => error);

    clock.advanceMs(1_051);
    const read = await catalogue.read(provider);

    expect(read.listing.carParks).toHaveLength(1);
    expect(calls()).toBe(2);
    await lost;
  });
});
