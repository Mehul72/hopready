# What HopReady needs from you

Everything that needs your accounts, money or a decision. Each item says why it is needed, the default used until you answer, and the exact steps. Items marked **blocks** stop something specific; nothing here stops local development, which runs in demo mode.

## How to hand over secrets

Never paste a key into a chat, an issue or a file in this repository.

- **Text secrets** (API tokens): store each one in your macOS login Keychain. Run this in your own Terminal; it asks for the value without echoing it:

  ```sh
  security add-generic-password -U -s hopready -a TFNSW_API_KEY -w
  ```

  Use the same command with the other names below (`EXPO_TOKEN`, `CLOUDFLARE_API_TOKEN` and so on). Commands that need a value read it with `security find-generic-password -s hopready -a NAME -w` and pass it straight to the tool, without printing it.

- **Key files** (`.p8`): keep them outside the repository.

  ```sh
  mkdir -p ~/.config/hopready && chmod 700 ~/.config/hopready
  mv ~/Downloads/AuthKey_XXXXXXXXXX.p8 ~/.config/hopready/ && chmod 600 ~/.config/hopready/*.p8
  ```

  Then tell me the file name. Key IDs and issuer IDs are not secret.

- **Production secrets:** add them as GitHub Actions secrets (repository Settings > Secrets and variables > Actions), or run `gh secret set NAME --repo Mehul72/hopready` and paste at the prompt. The deploy workflow copies them into Cloudflare.

## Required for live trips

### 1. TfNSW Open Data token (free). Blocks live public transport, stops and car parks.

Why: every journey, stop search, alert and car park figure comes from TfNSW.

1. Register at https://opendata.transport.nsw.gov.au/data/user/register (username, email, password, accept the terms).
2. Log in, click your profile icon, then **API Tokens**. Name it `hopready-backend-prod` and click **Create API Token**. It is shown once.
3. Make a second token, `hopready-backend-dev`, for local development (TfNSW asks for one key per application).
4. Keychain: `TFNSW_API_KEY` (the dev token). GitHub secret: `TFNSW_API_KEY` (the prod token).
5. Before launch, email TfNSW through the Open Data Hub to raise the default 5 requests per second and 60,000 per day. They have raised it for free before.

### 2. Apple Maps Server API key (free with your membership). Blocks live drive times, drive routes and address search.

Why: drive legs and address search use Apple Maps, which also keeps the in-app map key-free. See docs/decisions/0002.

1. Go to https://developer.apple.com/account/resources/identifiers/list, click **+**, choose **Maps IDs** and continue.
2. Description `HopReady backend prod`, identifier `maps.au.hopready.prod`. Register. Optionally repeat with `.dev`.
3. Go to https://developer.apple.com/account/resources/authkeys/list, click **+**, and name the key `HopReady Maps Server prod`.
4. Tick **MapKit JS**, click **Configure**, pick the Maps ID, then **Save**, **Continue**, **Register**.
5. **Download** the `.p8` file (once only) and note the 10-character Key ID.
6. Store the file in `~/.config/hopready/`, then tell me the Key ID. Your Team ID is `MACDPWQG37` (read from this Mac).
7. GitHub secrets: `APPLE_MAPS_TEAM_ID`, `APPLE_MAPS_KEY_ID`, and `APPLE_MAPS_PRIVATE_KEY` (the file's contents: `gh secret set APPLE_MAPS_PRIVATE_KEY --repo Mehul72/hopready < ~/.config/hopready/AuthKey_XXXXXXXXXX.p8`).
8. Accept any pending agreement shown on your developer account page.

### 3. Cloudflare account and deploy token. Blocks deploying the API.

Why: the API runs on Cloudflare Workers (docs/decisions/0003).

1. Sign up at https://dash.cloudflare.com/sign-up and turn on two-factor authentication.
2. Copy your **Account ID** from Workers & Pages > Overview.
3. Go to My Profile > API Tokens > Create Token, and use the **Edit Cloudflare Workers** template, limited to your account.
4. Keychain: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. GitHub secrets: the same two names.
5. Decide on **Workers Paid (US$5/month)** before public launch. The free plan's 10 ms CPU limit is likely to fail some searches. This needs your approval because it is a paid plan.
6. Optional but recommended before App Store release: a domain for the API (for example `api.<your-domain>`), because `workers.dev` names can be changed by Cloudflare with a week's notice.

## Required for a TestFlight build

### 4. Expo account and token. Blocks EAS builds and submission.

1. Sign up at https://expo.dev/signup (free plan: 15 iOS builds a month; local builds do not count).
2. Create a token at https://expo.dev/settings/access-tokens.
3. Keychain: `EXPO_TOKEN`. Tell me the Expo username, or the organisation name if you want the project under one.

### 5. App Store Connect app record. Blocks the first TestFlight upload.

Apple's API cannot create app records, so this step is yours.

1. As Account Holder, open App Store Connect > **Business** and accept the latest agreement if one is waiting.
2. Open https://appstoreconnect.apple.com/apps, click **+**, then **New App**, and fill in:
   - Platform: iOS
   - Name: **HopReady**. No app with this name was found in the AU, US, GB or NZ stores on 2026-10-25.
   - Primary language: English (Australia)
   - Bundle ID: `au.hopready.HopReady` (see item 8). If it is not listed yet, register it under Identifiers > App IDs, or let step 6 register it.
   - SKU: `HOPREADY-IOS-1`
   - User access: Full Access
3. Open App Information and send me the numeric **Apple ID**. It goes in `eas.json` as `ascAppId`.

### 6. One interactive signing setup (about 5 minutes, needs your Apple ID and 2FA)

EAS cannot create a distribution certificate non-interactively, so this has to run once in your own Terminal:

```sh
cd ~/hopready/apps/mobile
EXPO_TOKEN="$(security find-generic-password -s hopready -a EXPO_TOKEN -w)" npx eas-cli@latest credentials -p ios
```

1. Choose the production profile and let EAS create the distribution certificate and provisioning profile.
2. Then choose **App Store Connect: Manage your API Key** > set up a key for EAS Submit, and let EAS generate and store it. You never handle a `.p8` this way.
3. After this, I can build and upload to TestFlight without further prompts.

### 7. TestFlight testers

Internal testers must be users in your App Store Connect team (up to 100). They need no Beta App Review.

Default: just you. Install the TestFlight app on your iPhone. Tell me any other testers' emails.

## Decisions, with the default in use

| #   | Decision                                                                          | Default until you answer                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8   | Bundle ID (permanent after the first upload)                                      | `au.hopready.HopReady`, following your `au.kerbside.Kerbside` pattern                                                                                                                                                                                                                                                                                                                                           |
| 9   | Pushing and pull requests. Your AGENTS.md forbids them; the brief asked for them. | Commit locally on `feat/hopready-v1` only. Say "push allowed" and I will push the branch, open a draft PR, enable GitHub Pages and set Actions secrets, without ever merging. Note: your first GitHub commit used the noreply address. If "Block command line pushes that expose my email" is on, pushes with `mehulfursule@gmail.com` will be rejected (GH007). That fix is yours; I do not change identities. |
| 10  | Monthly spending                                                                  | Free tiers only. Recommended: Workers Paid (US$5/month) before launch. Nothing paid gets turned on without your yes.                                                                                                                                                                                                                                                                                            |
| 11  | Seller name shown on the App Store                                                | Your legal name, because the team is an individual membership. Confirm it.                                                                                                                                                                                                                                                                                                                                      |
| 12  | Support email, shown on the support page and in the privacy policy                | **No default. Needed before release.** The pages say "support email to be confirmed" until then.                                                                                                                                                                                                                                                                                                                |
| 13  | Privacy policy and support URLs                                                   | `https://mehul72.github.io/hopready/privacy/` and `/support/`. They go live once the branch is on GitHub and Pages is enabled.                                                                                                                                                                                                                                                                                  |
| 14  | Countries                                                                         | Australia only. Coverage is Greater Sydney, and staying out of the EU means no Digital Services Act trader details.                                                                                                                                                                                                                                                                                             |
| 15  | Price                                                                             | Free, with no purchases.                                                                                                                                                                                                                                                                                                                                                                                        |
| 16  | Analytics and crash reporting                                                     | None. This keeps the privacy label minimal. Sentry would need an account and changes the disclosures.                                                                                                                                                                                                                                                                                                           |
| 17  | Repository licence                                                                | None (all rights reserved), even though the repository is public.                                                                                                                                                                                                                                                                                                                                               |
| 18  | Navigation apps for "Start driving"                                               | Apple Maps, plus Google Maps and Waze when installed                                                                                                                                                                                                                                                                                                                                                            |
| 19  | Trip defaults                                                                     | Drive at most 30 min, walk at most 15 min per walk. Buffers: parking 8 min, drop-off 2 min, transfer 3 min, car retrieval 5 min. All editable in the app.                                                                                                                                                                                                                                                       |
| 20  | Installing developer tools on this Mac                                            | CocoaPods 1.17.0 is installed with a wrapper at `~/.local/bin/pod`. Maestro gets installed for end-to-end tests if the session allows it.                                                                                                                                                                                                                                                                       |

## Status of each item

Kept current in docs/PROGRESS.md.
