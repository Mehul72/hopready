import {
  systemClock,
  type CarParkProvider,
  type Clock,
  type DrivingProvider,
  type PlaceSearchProvider,
  type TransitProvider,
} from '../providers';
import { createDemoCarParkProvider } from './car-park-provider';
import { createDemoDrivingProvider } from './driving-provider';
import { createDemoPlaceSearchProvider } from './place-search-provider';
import { demoScenarioSchema, type DemoScenario } from './scenarios';
import { createDemoTransitProvider } from './transit-provider';

// The demo world: a small Greater Sydney network on real stops with generated, clearly labelled
// timetables, plus drive, car park and place search models. It runs the same planner as live mode,
// on the device or in the API, and never calls a real provider.

export { DEMO_PLACES, type DemoPlaceId } from './places';
export {
  DEMO_SCENARIO_IDS,
  DEMO_SCENARIOS,
  demoScenarioSchema,
  type DemoScenario,
  type DemoScenarioInfo,
} from './scenarios';

export interface DemoProviders {
  transit: TransitProvider;
  driving: DrivingProvider;
  carParks: CarParkProvider;
  places: PlaceSearchProvider;
}

export interface DemoProviderOptions {
  clock?: Clock;
  scenario?: DemoScenario;
}

export function createDemoProviders(options: DemoProviderOptions = {}): DemoProviders {
  const clock = options.clock ?? systemClock;
  // The scenario often comes from stored settings, so check it rather than trust it.
  const scenario = demoScenarioSchema.parse(options.scenario ?? 'normal');
  return {
    transit: createDemoTransitProvider({ clock, scenario }),
    driving: createDemoDrivingProvider(),
    carParks: createDemoCarParkProvider({ clock, scenario }),
    places: createDemoPlaceSearchProvider(),
  };
}
