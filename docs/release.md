# Releasing HopReady

How a build gets from this repository to TestFlight and then the App Store, and the store listing to use. The steps that need your Apple, Expo or Cloudflare accounts are in docs/OWNER-ACTIONS.md.

## Builds

EAS build profiles are in `apps/mobile/eas.json`.

| Profile       | Use                                             | Distribution                                         |
| ------------- | ----------------------------------------------- | ---------------------------------------------------- |
| `development` | Simulator development build with the dev client | Simulator only                                       |
| `preview`     | Internal test build on registered iPhones       | Ad hoc (devices registered with `eas device:create`) |
| `production`  | TestFlight and App Store                        | App Store Connect                                    |

```sh
cd apps/mobile
export EXPO_TOKEN="$(security find-generic-password -s hopready -a EXPO_TOKEN -w)"
# Cloud build (uses 1 of 15 free iOS builds a month):
npx eas-cli@latest build -p ios --profile production
# Or build on this Mac (needs fastlane and CocoaPods; does not use the cloud quota):
npx eas-cli@latest build -p ios --profile production --local
# Upload to TestFlight:
npx eas-cli@latest submit -p ios --profile production --latest
```

A successful upload is not the end of it. Apple then processes the build, which usually takes 10 to 15 minutes, and only after that can testers install it. Check App Store Connect > TestFlight for the build state before reporting it as available.

## TestFlight checklist

1. Run `pnpm check` on the commit being built. The iOS simulator build and Maestro flows pass (see docs/testing.md).
2. The production API is deployed, and `GET /v1/health` reports `transit`, `driving` and `carParks` as `configured`.
3. `EXPO_PUBLIC_API_BASE_URL` for the production profile points at that API.
4. Version and build number: `app.config.ts` version is set, and EAS auto-increments the build number (`appVersionSource: remote`).
5. Build, then submit. Wait until App Store Connect shows the build as **Ready to Submit** or **Testing**, not **Processing**.
6. Export compliance: none should be asked, because the app declares `ITSAppUsesNonExemptEncryption = false` (standard HTTPS only).
7. Internal testers: add them to the internal group. No Beta App Review is needed for internal testing.
8. On a real iPhone, test:
   - location allow and deny;
   - planning a live trip from your current location and from a typed address;
   - park and ride;
   - drop-off;
   - "I parked here", then quitting the app, reopening it, and "Take me home";
   - "Start driving" opening Apple Maps;
   - offline behaviour (Airplane Mode);
   - dark mode;
   - the largest text size;
   - VoiceOver on the results and trip screens.
9. Do not invite external testers or submit for review without the owner's approval.

## Store listing (draft)

| Field              | Value                                                                                      | Limit        |
| ------------------ | ------------------------------------------------------------------------------------------ | ------------ |
| Name               | HopReady                                                                                   | 30           |
| Subtitle           | Drive, park and ride Sydney                                                                | 30 (27 used) |
| Category           | Navigation (primary), Travel (secondary)                                                   |              |
| Price              | Free, no in-app purchases                                                                  |              |
| Availability       | Australia only                                                                             |              |
| Age rating         | 4+ (every questionnaire answer None; the app opens links in Safari, not an in-app browser) |              |
| Copyright          | © 2026 Mehul Fursule                                                                       |              |
| Support URL        | https://mehul72.github.io/hopready/support/                                                |              |
| Privacy policy URL | https://mehul72.github.io/hopready/privacy/                                                |              |

**Promotional text** (up to 170 characters):

> Drive to a commuter car park, catch the metro or a bus, and get home through wherever you actually parked. One plan, door to door, for Greater Sydney.

**Keywords** (up to 100 characters, no spaces after commas). Trademarks HopReady does not own, such as Opal, are deliberately left out:

```
park and ride,commuter parking,metro,train,bus,transfer,trip planner,door to door,nsw,car park
```

**Description:**

> HopReady plans the whole trip when you drive part of the way and take public transport the rest.
>
> Tell HopReady where you are going and when you need to leave or arrive. It compares realistic options side by side:
> • Public transport only
> • Drive to a commuter car park, then metro, train or bus
> • Get dropped off at a station, then public transport
> • Drive the whole way
>
> Each option shows when to leave, when you arrive, how long you drive and walk, how many changes, and which car park to use, with how many spaces were free at last count and how old that count is. Times from Transport for NSW are marked Live or Timetable, and service changes are shown with the trip.
>
> Open an option for a step-by-step timeline and a map with every leg. Tap Start driving to hand the drive to Apple Maps, Google Maps or Waze.
>
> After you park, confirm where your car actually is. Take me home then plans public transport back to your car and the drive home from there. Dropped off instead? HopReady plans public transport home.
>
> Set your own limits: how far you are willing to drive and walk, and how much time to allow for parking and making connections.
>
> Good to know:
> • Covers Greater Sydney, including the Central Coast and Blue Mountains.
> • Car park counts are estimates of spaces free now, not a guarantee when you arrive.
> • Location is optional; you can always type a place.
> • No account. Your saved places and parked car stay on your iPhone.
>
> Public transport and car park data © Transport for NSW (CC BY 4.0). Maps and drive times by Apple Maps.

## App Review notes (draft)

> HopReady plans trips in Greater Sydney, Australia, that combine driving, commuter parking, walking and public transport. No login is needed.
>
> Live results only exist for Greater Sydney. If you are testing elsewhere:
>
> 1. Plan tab: type "Box Hill NSW" as the start and "1 Help Street, Chatswood" as the destination. Choose Arrive by, a weekday, 9:00 am (times are Sydney time). Turn on "I'll drive and park", then tap Plan. The options include driving to a Sydney Metro car park, then the metro.
> 2. Open an option to see the timeline and map. Tap "I parked here" to confirm the car park.
> 3. Car tab: tap "Take me home". It plans public transport back to the car, then the drive.
> 4. Location access is optional. Every screen works with typed places.
>
> Demo mode (Settings > Demo mode) shows sample trips from built-in data. It is labelled on every screen while on, and is never mixed with live results.
>
> Data: Transport for NSW Open Data (CC BY 4.0) and Apple Maps Server API, called from our backend. The app sends no data until the user agrees on first use.

## App Privacy answers

What the app does:

- Saved data stays on the device, and leaves it only inside a request the person makes. Planning with "I'll drive and park" sends the saved parking spots (names and positions); Take me home sends the parked car's position.
- Trip and search requests reach the HopReady API, which keeps no locations, addresses or search text (logs exclude them).
- The API sends positions and search text to Transport for NSW and Apple Maps, server to server, without any identifier. Place names stay with the API.
- From the phone itself, Apple receives map tile requests (the area on screen) and, in live mode, iOS reverse-geocoding requests for the current location.
- Searches carry the location rounded to about 1 km when location access was granted.
- There is no analytics, advertising or tracking SDK.

Apple's definition: data is "collected" only when it is retained beyond servicing the request.

| Option                                                                 | When it is true                                                          | Answers                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A, conservative (recommended until TfNSW's log retention is confirmed) | A provider may keep request logs that include coordinates or search text | Data Collected: **Location > Precise Location** and **Search History**. Both App Functionality, not used for tracking, **Linked to the user: No**. Neither carries any identifier, but a typed home address can be personal information under Australian privacy law, so read Apple's de-identification guidance before answering. |
| B                                                                      | Neither the API nor any provider keeps the data after answering          | Data Not Collected                                                                                                                                                                                                                                                                                                                 |

The app's privacy manifest (`apps/mobile/app.config.ts`) declares the option A data types. If option B is chosen, empty `NSPrivacyCollectedDataTypes` in the same change, so the manifest and the label agree.

Also confirm in App Store Connect:

- **DSA trader status:** Business > Agreements > Compliance > Digital Services Act > "This is not a trader account". This is accurate while availability is Australia only.
- **Encryption:** standard HTTPS only, so exempt.

## Screenshots

- **Sizes:** 6.9" (1320 × 2868, from the iPhone 17 Pro Max or 18 Pro Max simulator) and 6.3" (1206 × 2622, from the iPhone 17 Pro or 18 Pro simulator).
- **Format:** JPEG with no alpha channel. Use `xcrun simctl io booted screenshot --type=jpeg file.jpg`.
- **Live data:** capture them in live mode once the production API is up. Demo-mode captures show the demo banner and are for internal review only.
- **April 2027:** Apple's iOS 27 SDK requirement also brings iPhone Duo screenshots. Those need Xcode 27.1 or later.
