import { z } from 'zod';

// Demo scenarios let people and tests trigger timing and failure cases on purpose. Every scenario
// is demo data: nothing here describes a real disruption.

export const DEMO_SCENARIO_IDS = [
  'normal',
  'cancelled-service',
  'tight-transfer',
  'provider-timeout',
  'rate-limited',
  'stale-occupancy',
  'no-route',
] as const;

export const demoScenarioSchema = z.enum(DEMO_SCENARIO_IDS);
export type DemoScenario = z.infer<typeof demoScenarioSchema>;

export interface DemoScenarioInfo {
  id: DemoScenario;
  title: string;
  description: string;
}

export const DEMO_SCENARIOS: readonly DemoScenarioInfo[] = [
  {
    id: 'normal',
    title: 'Everything running',
    description: 'Services run to the demo timetable and car park counts are a minute or two old.',
  },
  {
    id: 'cancelled-service',
    title: 'Cancelled metro services',
    description:
      'Every second M1 Metro service that starts between 6.30 am and 9.30 am is cancelled.',
  },
  {
    id: 'tight-transfer',
    title: 'Tight bus to metro connection',
    description:
      'Route 280 buses reach Chatswood 2 minutes before the metro leaves, which is less than the default transfer buffer.',
  },
  {
    id: 'provider-timeout',
    title: 'Public transport times out',
    description:
      'The demo public transport service never answers, so plans give up after the timeout.',
  },
  {
    id: 'rate-limited',
    title: 'Public transport busy',
    description:
      'The demo public transport service says it is busy and asks to try again in 30 seconds.',
  },
  {
    id: 'stale-occupancy',
    title: 'Old car park counts',
    description: 'Car park occupancy figures are several hours old.',
  },
  {
    id: 'no-route',
    title: 'No public transport found',
    description: 'The demo public transport service finds no journeys for any trip.',
  },
];

export interface TimetableSettings {
  // Every second M1 service starting in the morning window is cancelled.
  cancelMorningMetro: boolean;
  // How long route 280 allows for changing to or from the metro at Chatswood.
  feederConnectionMinutes: number;
}

export interface ScenarioSettings {
  timetable: TimetableSettings;
  // The shortest change between two services at the same stop that the demo planner offers.
  minimumChangeMinutes: number;
}

const NORMAL_SETTINGS: ScenarioSettings = {
  timetable: { cancelMorningMetro: false, feederConnectionMinutes: 5 },
  minimumChangeMinutes: 3,
};

export function scenarioSettings(scenario: DemoScenario): ScenarioSettings {
  switch (scenario) {
    case 'cancelled-service':
      return {
        ...NORMAL_SETTINGS,
        timetable: { ...NORMAL_SETTINGS.timetable, cancelMorningMetro: true },
      };
    case 'tight-transfer':
      return {
        timetable: { ...NORMAL_SETTINGS.timetable, feederConnectionMinutes: 2 },
        minimumChangeMinutes: 2,
      };
    case 'normal':
    case 'provider-timeout':
    case 'rate-limited':
    case 'stale-occupancy':
    case 'no-route':
      return NORMAL_SETTINGS;
  }
}
