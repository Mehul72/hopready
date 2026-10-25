# ADR-0005: Expo SDK 58 app, Hono API and a shared core package in one pnpm workspace

## Status

Accepted

## Date

2026-10-25

## Context

The repository was empty apart from a README. The brief defaults to React Native with Expo and TypeScript, Expo Router, a TypeScript backend, local storage, and EAS build profiles.

Expo SDK 58 went stable on 2026-10-15, with React Native 0.88, React 19.3 and TypeScript 6.0. The New Architecture is always on, and CocoaPods is still the iOS default. The build machine has Xcode 27.0 and Node 24.

## Decision

- A pnpm workspace with `nodeLinker: hoisted`, because Metro and several native modules still expect a flat `node_modules`:
  - `apps/mobile`: the Expo SDK 58 app (default template, Expo Router under `src/app`, native tabs)
  - `apps/api`: Hono
  - `packages/core`: the shared model, planner, time and geo helpers, fixtures and catalogue
- Native modules are installed at the versions SDK 58 pins in `bundledNativeModules.json`.
- On-device storage is `expo-sqlite/kv-store`.
- Tests:
  - Vitest for core and the API
  - jest-expo with React Native Testing Library for the app
  - Maestro against an iOS simulator for end-to-end
- ESLint is held at 9.x, because `eslint-plugin-react` (pulled in by `eslint-config-expo`) does not support ESLint 10 yet.

## Alternatives considered

### Separate repositories for app and API

- Rejected. The plan request and response contract would be duplicated and drift. A shared zod schema in `packages/core` validates both sides.

### react-native-mmkv for storage

- Rejected. It is not pinned by SDK 58, needs Nitro modules, and its React Native 0.88 compatibility is unverified.

### Detox for end-to-end tests

- Rejected. It supports only React Native 0.77 to 0.84, and has open Xcode 27 issues.

## Consequences

### Positive

- One `pnpm check` runs typecheck, lint, tests and format check everywhere, and CI calls the same scripts.
- Planner rules have a single implementation, shared by the server and on-device demo mode.

### Negative

- pnpm 11 enforces a minimum release age. A version published in the last day is rejected (seen with `hono@4.13.14`), so pin to slightly older releases.
- Changing `allowBuilds` in `pnpm-workspace.yaml` makes `pnpm install` wait at a prompt. Run it with `--config.confirm-modules-purge=false < /dev/null` in automation.
- The Homebrew on the build Mac is the Intel build under Rosetta and cannot build CocoaPods on macOS 27. CocoaPods 1.17 runs on Homebrew's bundled Ruby through a wrapper in `~/.local/bin/pod` (see docs/setup.md).
- ESLint 9 is marked deprecated upstream. Move to 10 when `eslint-plugin-react` supports it.

## Revisit if

- Expo moves iOS builds to Swift Package Manager by default.
- `eslint-config-expo` supports ESLint 10.
- A second client (web or Android) needs a different storage or map layer.

## Correction (2026-10-26)

End-to-end tests use XCUITest, not Maestro. Installing Maestro was refused by the permission policy of the session that built HopReady, and no Maestro flows were written. XCUITest comes with Xcode and runs the same journeys against a Release simulator build (docs/testing.md). The rest of the decision is unchanged.
