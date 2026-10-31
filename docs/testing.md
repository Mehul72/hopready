# Testing HopReady

Five layers, from fastest to slowest. CI runs the first three on every push (`.github/workflows/ci.yml`). Run them locally with `pnpm check`.

| Layer                     | What it covers                                                                                                                                                                                                                                                                                                                                                                | Command                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Core (Vitest)             | Routing rules, Sydney time and daylight saving, the planner against fakes, and every scenario from the brief against the demo world                                                                                                                                                                                                                                           | `pnpm --filter @hopready/core test`                            |
| API (Vitest)              | Routes, validation, error mapping, deadlines, rate limits, budgets, log redaction, and the TfNSW and Apple Maps adapters against schema-derived samples                                                                                                                                                                                                                       | `pnpm --filter @hopready/api test`                             |
| App (Jest)                | Storage, the API client, the trip service (demo and live never mixed), location permission paths, and screen flows with React Native Testing Library. Compiled with the React Compiler, as the app is built, so a value the compiler would keep from an earlier render (such as a clock read) fails here too                                                                  | `pnpm --filter @hopready/mobile test`                          |
| Live providers            | One real call per TfNSW and Apple Maps method. Skipped without keys.                                                                                                                                                                                                                                                                                                          | `pnpm --filter @hopready/api exec vitest run live` (see below) |
| iOS end-to-end (XCUITest) | The real app on an iOS simulator in demo mode: launch and tabs; planning a drive-and-park trip, its timeline and map, and Start driving opening Apple Maps; planning from the current location after allowing location access; confirming where the car is parked, relaunching, denying location, and planning Take me home through the car; a screenshot of each main screen | see below                                                      |

## Live provider tests

They need real keys in the environment and never run in CI by default. The manual "Live provider checks" workflow fails, rather than skipping, when the secrets are missing.

```sh
export TFNSW_API_KEY="$(security find-generic-password -s hopready -a TFNSW_API_KEY -w)"
export APPLE_MAPS_TEAM_ID=MACDPWQG37
export APPLE_MAPS_KEY_ID=XXXXXXXXXX
export APPLE_MAPS_PRIVATE_KEY="$(cat ~/.config/hopready/AuthKey_XXXXXXXXXX.p8)"
pnpm --filter @hopready/api exec vitest run live
# Record real TfNSW responses so the parser tests run against them too:
npx tsx apps/api/scripts/record-tfnsw-samples.ts
```

## iOS end-to-end tests (XCUITest)

The UI-test target is added to the generated iOS project by `apps/mobile/plugins/with-ios-ui-tests.js`, only when `HOPREADY_IOS_UI_TESTS=1`. Store builds never include it. Tests live in `apps/mobile/e2e/ios/`; prebuild copies them into the project, and adds any new file to the target.

They run against a Release simulator build, so the JavaScript is bundled in and no development server or dev-client launcher is involved. The build has no API address, so the app never sends anything; each test starts with Settings > Delete all HopReady data, then turns on demo mode.

```sh
cd apps/mobile
HOPREADY_IOS_UI_TESTS=1 CI=1 npx expo prebuild --platform ios
cd ios
xcrun simctl boot "iPhone 18 Pro" || true
xcodebuild build-for-testing -workspace HopReady.xcworkspace -scheme HopReady \
  -configuration Release -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro' -derivedDataPath build
xcodebuild test-without-building \
  -xctestrun build/Build/Products/HopReady_iphonesimulator*.xctestrun \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro' \
  -collect-test-diagnostics never -only-testing:HopReadyUITests
```

`HopReadyLiveApiTests` skips in that build, because a build with no API address never asks for the live data agreement. To run it, start a local API that serves the demo data, then build with its address. The address is read when the app is bundled, so it goes on the build command:

```sh
HOPREADY_MODE=demo pnpm api:dev   # in another terminal, from the repo root; serves http://localhost:8787
cd apps/mobile/ios
EXPO_PUBLIC_API_BASE_URL=http://localhost:8787 xcodebuild build-for-testing \
  -workspace HopReady.xcworkspace -scheme HopReady -configuration Release -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro' -derivedDataPath build
xcodebuild test-without-building \
  -xctestrun build/Build/Products/HopReady_iphonesimulator*.xctestrun \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro' \
  -collect-test-diagnostics never -only-testing:HopReadyUITests/HopReadyLiveApiTests
```

It agrees to the live data agreement, then plans the drive-and-park trip with every search and the plan going over HTTP to the API. Rebuild without the variable before running the demo journeys again.

Notes:

- `--clean` regenerates the project from scratch and deletes `ios/build`, which holds several gigabytes of build cache. Leave it off unless the native configuration changed.
- The demo timetable has no services between about 1.30 am and 4.30 am Sydney time, so runs before 10 am set "Depart at" 10:00 am, and later runs leave now (the picker never goes earlier than now).
- One XCUITest wheel adjustment can stop a few rows short on the iOS 27 simulator, so the helper repeats it until the wheel shows the wanted value, then checks the time the picker shows.
- Each test resets the app's location permission first, so no test depends on what an earlier one allowed or denied.
- Without `-collect-test-diagnostics never`, a failing test makes `xcodebuild` gather a sysdiagnose, which takes many minutes and looks like a hang.
- On a failure, `xcrun xcresulttool export attachments --path build/<name>.xcresult --output-path <dir>` exports the screenshots, the screen recording and the app's accessibility hierarchy. `testCapturesTheMainScreens` keeps a screenshot of each main screen the same way.

Maestro is not used. Installing it was refused by the permission policy in the session that built HopReady, and XCUITest covers the same journeys with Apple's own tooling.

## What the tests deliberately do not claim

- The TfNSW samples are built from the published schema, not recorded. Recorded responses replace them once a key exists (see `apps/api/src/providers/tfnsw/__fixtures__/README.md`).
- The demo world uses real stops but generated timetables. It shows that the planner's rules hold, not what TfNSW will return.
- Simulator runs do not prove behaviour on a physical iPhone (GPS, real network conditions, performance). The TestFlight checklist in docs/release.md covers that.
