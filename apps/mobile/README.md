# HopReady iPhone app

Expo SDK 58 (React Native 0.88, React 19.3, Expo Router) with code under `src/`. The app plans trips through the HopReady API in live mode, or runs the same planner on the device with labelled sample data in demo mode. The full machine setup, including CocoaPods, is in [docs/setup.md](../../docs/setup.md).

## Run it

1. Install the workspace from the repository root:

   ```sh
   pnpm install
   ```

2. Build a development build (expo-dev-client, not Expo Go) and open it in the iOS simulator:

   ```sh
   cd apps/mobile
   npx expo run:ios
   ```

3. Try it in demo mode: open **Settings** and turn on **Demo mode**. Trips come from built-in data, no server is needed, and a banner stays on every screen while it is on.

4. Use live mode against an API (local or deployed). The address is read when the app is built or started:

   ```sh
   EXPO_PUBLIC_API_BASE_URL=http://localhost:8787 npx expo run:ios
   ```

   With an address, the first launch explains what live planning sends and asks for agreement before anything is sent (docs/decisions/0006). Without an address, live mode reports "not set up" and offers demo mode. It never switches by itself.

## Check it

```sh
cd apps/mobile
npx tsc --noEmit
npx expo lint
npx jest
```

## Build-time settings

`app.config.ts` reads these from the environment (an EAS environment or your shell). None of them is secret: the app holds no provider keys.

| Variable                      | Sets                                                                                                             | When unset                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `EXPO_PUBLIC_API_BASE_URL`    | `extra.apiBaseUrl`, the API address                                                                              | Live mode is "not configured"                 |
| `HOPREADY_IOS_BUNDLE_ID`      | `ios.bundleIdentifier`                                                                                           | `au.hopready.HopReady`                        |
| `HOPREADY_PRIVACY_POLICY_URL` | `extra.privacyPolicyUrl`                                                                                         | `https://mehul72.github.io/hopready/privacy/` |
| `HOPREADY_SUPPORT_URL`        | `extra.supportUrl`                                                                                               | `https://mehul72.github.io/hopready/support/` |
| `EAS_PROJECT_ID`              | `extra.eas.projectId`                                                                                            | Left out                                      |
| `HOPREADY_APPLE_TEAM_ID`      | `ios.appleTeamId`                                                                                                | `MACDPWQG37`                                  |
| `HOPREADY_DEMO_SCENARIOS`     | `extra.demoScenarios` (`1` shows the staged-failure picker in demo mode; set for development and preview builds) | Off, as in store builds                       |
| `HOPREADY_IOS_UI_TESTS`       | Adds the XCUITest target at prebuild (docs/testing.md)                                                           | No test target                                |

## Where things are

| Folder             | What it holds                                                                                                                                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app`          | Routes only. Every file here becomes a route and ships in the bundle, so tests live elsewhere.                                                                                                                              |
| `src/features`     | The screens, one folder per area: `plan`, `results`, `itinerary`, `parked-car`, `saved`, `settings` and `consent`, with their flow tests. `shared` holds wording used by several, such as car park counts and option names. |
| `src/theme`        | Colour tokens for light and dark (WCAG AA, checked by `contrast.test.ts`), transport mode colours, labels and SF Symbols, typography and spacing. `useTheme()` returns the current theme.                                   |
| `src/components`   | Building blocks for screens (list below).                                                                                                                                                                                   |
| `src/storage`      | Everything saved on the device, in `expo-sqlite/kv-store`: stores, hooks and `deleteAllData()`.                                                                                                                             |
| `src/api`          | The HTTP client for the HopReady API, `ApiError`, and the TanStack Query client.                                                                                                                                            |
| `src/trip`         | `tripService` (plans, place search and car parks, in live or demo mode), query hooks, the refresh policy and the resume hook.                                                                                               |
| `src/state`        | `planSession`, the shared store for the latest search, its results and the active trip refresh.                                                                                                                             |
| `src/location`     | `requestCurrentPlace()` and the location permission hook.                                                                                                                                                                   |
| `src/test-support` | Jest mocks for native modules, and builders for places, requests and itineraries.                                                                                                                                           |

### Components

`Screen`, `AppText`, `Button`, `IconButton`, `Card`, `Chip`, `SegmentedControl`, `ListRow`, `SectionHeader`, `Banner`, `EmptyState`, `ErrorState`, `LoadingState`, `ModeIcon`, `TimingBadge`, `Stepper`, `TripMap` and `DemoModeBanner`, all exported from `@/components`. Each one has a role and a spoken label, a touch target of at least 44 points, scales with Dynamic Type, and follows light and dark mode.

## Rules for screens

- **Wrap every screen in `Screen`.** It handles safe areas, scrolling, the keyboard and a readable width. Inside a modal sheet it also shows the demo banner, which the window-wide strip cannot reach. Its `footer` is for stack and modal screens; on a tab screen the tab bar covers it.
- **Get data through `planSession` (`@/state`) and `@/trip`.** `planSession.plan(request)`, `refresh()` (at most every 30 seconds) and `select(id)` drive the results and itinerary screens. `usePlaceSearch(text, near)` debounces and needs 2 characters (the place search sheet waits for 3); `useCarParks()` lists Park&Ride car parks. Never call `fetch` from a screen.
- **Errors are `ApiError`.** Show `error.message` and choose the action from `error.kind`. When `error.suggestsDemoMode` is true, offer a button that turns demo mode on (`appStorage.settings.setDemoMode(true)`); never turn it on without the person asking.
- **Show a `TripMap` on any screen that shows drive times or Apple search results.** Apple's terms only allow that data next to an Apple map. Pass `bottomInset` when a sheet covers the map so Apple's legal link stays visible.
- **Ask for location only from a tap,** through `requestCurrentPlace()`. Pass `lookUpStreetName: true` only in live mode: naming the street sends the position to Apple through iOS, and demo mode sends nothing. On `denied`, offer manual entry, plus `openLocationSettings()` when `canAskAgain` is false. A recent trip from "Current location" holds the old coordinates, so ask for the location again when it is reused.
- **Text goes through `AppText` and colour through `useTheme()`.** Never mark meaning by colour alone: modes have icons and names, timings have labels, selection has a tick or a raised segment.
- **SF Symbols are limited to version 4.2** by the type checker (`src/theme/sf-symbols.d.ts`), because the app supports iOS 16.4.

## The API contract this client expects

| Call                     | Request                                                               | Response                                                                   |
| ------------------------ | --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `POST /v1/plan`          | A core `PlanRequest`                                                  | A core `PlanResponse`                                                      |
| `POST /v1/places/search` | `{ "query": "2 to 80 characters", "near": { "lat", "lon" } \| null }` | `{ "results": [{ "place", "detail" }], "unavailable": ["provider name"] }` |
| `GET /v1/carparks`       | Nothing                                                               | `{ "carParks": [CarParkFacility with "occupancy"], "notices": [] }`        |

Nothing is sent until the person has agreed to live data use; until then requests fail with `consent-required`. POST bodies go as `application/json` (the API answers anything else with 415). Every request carries `X-HopReady-Install`, a random version 4 UUID that is replaced when the person deletes all data. Errors are read from `{ "error": { "code" } }` (codes from `apps/api/src/errors.ts`) and the HTTP status; the server's own message is never shown. Requests time out after 15 seconds, so the API's plan deadline must be shorter.
