# Running HopReady locally

From a clean Mac to the app running in the iOS simulator, in demo mode first and then against a local API.

## Prerequisites

- macOS with Xcode 27.0 (Expo SDK 58 needs Xcode 26.4 or later) and an iOS simulator runtime.
- Node 24 (`.nvmrc`) and pnpm 11 (`packageManager` in `package.json`; `corepack enable` provides it).
- CocoaPods 1.17 or later on a Ruby of version 3 or later.
  - Homebrew: `brew install cocoapods`.
  - On the owner's Mac, the Intel Homebrew cannot build it under macOS 27. It runs from Homebrew's bundled Ruby instead:

    ```sh
    GEM_HOME="$HOME/.local/share/cocoapods-gems" \
      /usr/local/Homebrew/Library/Homebrew/vendor/portable-ruby/current/bin/gem install cocoapods --no-document
    # then a ~/.local/bin/pod wrapper that sets GEM_HOME and runs that Ruby (already installed on that Mac)
    ```

## 1. Install

```sh
git clone git@github.com:Mehul72/hopready.git && cd hopready
git switch feat/hopready-v1   # until the branch is merged; main holds only the first commit
CI=true pnpm install --frozen-lockfile --config.confirm-modules-purge=false < /dev/null
pnpm check
```

`pnpm check` runs typecheck, lint, every test suite and the format check. It is the same set CI runs.

## 2. Run the app in demo mode

```sh
cd apps/mobile
npx expo run:ios            # builds a development build and opens the simulator
```

In the app, open Settings and turn on **Demo mode**. Demo trips come from built-in data, and a banner shows while it is on.

## 3. Run the API and use live mode

1. Put provider keys in the Keychain (see docs/OWNER-ACTIONS.md). Then create `apps/api/.dev.vars` from `apps/api/.dev.vars.example`, or export the variables in your shell. `.dev.vars` is git-ignored.
2. Start the API:

   ```sh
   pnpm --filter @hopready/api dev        # Node, http://localhost:8787
   ```

3. Start the app pointing at it:

   ```sh
   cd apps/mobile
   EXPO_PUBLIC_API_BASE_URL=http://localhost:8787 npx expo run:ios
   ```

On first launch the app explains what live planning sends and asks for agreement (docs/decisions/0006). Tap **Agree and continue**; Settings > Live data use shows it again.

Without keys, run the API in demo mode instead (`HOPREADY_MODE=demo pnpm --filter @hopready/api dev`). The app then shows the demo banner for API responses too.

## 4. Live provider checks

```sh
export TFNSW_API_KEY="$(security find-generic-password -s hopready -a TFNSW_API_KEY -w)"
pnpm --filter @hopready/api exec vitest run live
```

Without the variables, these tests are skipped.
