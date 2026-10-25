# HopReady

An iPhone trip planner for Greater Sydney for trips that are part drive, part public transport. It compares public transport only, drive and park then ride, getting dropped off then riding, and driving the whole way. Once you have parked, "Take me home" plans the trip back through wherever your car actually is.

Live data comes from Transport for NSW Open Data (public transport, stops, car park occupancy) and the Apple Maps Server API (drive times, places, maps), called from HopReady's own API so the app holds no keys. Demo mode runs the same planner on the device against labelled sample data.

## Quick start: the app in demo mode

Needs macOS with Xcode 27, Node 24, pnpm 11 and CocoaPods. Details and the slower paths are in [docs/setup.md](docs/setup.md).

```sh
CI=true pnpm install --frozen-lockfile --config.confirm-modules-purge=false < /dev/null
cd apps/mobile
npx expo run:ios
```

In the simulator, open **Settings** and turn on **Demo mode**, then plan a trip on the **Plan** tab, for example from Box Hill to Chatswood. Without an API address the app never sends anything; live trips need the API (below).

## Run the API locally

```sh
HOPREADY_MODE=demo pnpm api:dev          # sample data, no keys needed
curl http://127.0.0.1:8787/v1/health
```

With provider keys in `apps/api/.dev.vars` (see [apps/api/README.md](apps/api/README.md)), leave out `HOPREADY_MODE=demo` to call Transport for NSW and Apple. Point the app at it with `EXPO_PUBLIC_API_BASE_URL=http://localhost:8787 npx expo run:ios`.

## Checks

```sh
pnpm check     # typecheck, lint, every unit test suite, format check (what CI runs)
```

The iOS end-to-end tests and the live provider tests are described in [docs/testing.md](docs/testing.md).

## Layout

| Path            | What it is                                                            |
| --------------- | --------------------------------------------------------------------- |
| `packages/core` | The trip model, Sydney time handling, the planner, and the demo world |
| `apps/api`      | The API on Cloudflare Workers (Hono), with the provider adapters      |
| `apps/mobile`   | The Expo app (React Native, Expo Router)                              |
| `site`          | The privacy policy and support pages, published with GitHub Pages     |
| `docs`          | Design, decisions, release and operations guides                      |

## Documentation

- [docs/PROGRESS.md](docs/PROGRESS.md): what is done, what is verified, and what is next.
- [docs/OWNER-ACTIONS.md](docs/OWNER-ACTIONS.md): accounts, keys and decisions that need the owner.
- [docs/design/routing.md](docs/design/routing.md): how a trip is planned, and the rules every option must meet.
- [docs/providers.md](docs/providers.md): the data sources, their limits and their terms.
- [docs/decisions/](docs/decisions/): why the stack, hosting, maps and demo mode are what they are.
- [docs/release.md](docs/release.md): TestFlight and App Store steps, store listing and privacy answers.
- [docs/runbook.md](docs/runbook.md): operating the API.

## Data and attribution

Public transport and car park data © Transport for NSW, licensed under CC BY 4.0. Maps, drive times and places from Apple Maps.
