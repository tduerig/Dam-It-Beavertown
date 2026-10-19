---
name: Mobile & Web Deployment (EAS / TestFlight / Android / Expo Go)
description: Formalized workflow for deploying and testing Beavers Dam It ("beavertown") on iPad/iOS (Expo Go, EAS Build, TestFlight), Android (Expo Go, internal APK preview, Google Play), and Web.
---

# Mobile & Web Deployment Protocol

This skill documents the project's configuration, portals, and exact CLI workflows for pushing builds of **Beavers Dam It** (`com.beaversdamit.app`) to iPad/iOS, Android, and Web.

## Project Identifiers & Portals
- **App Name**: `Beavers Dam It` ([`app.json`](../../../app.json))
- **Expo Slug**: `beavertown`
- **EAS Project ID**: `bdeb853c-0b1b-4970-a775-bee4b8a26c13`
- **App Store Connect App ID (`ascAppId`)**: `6763405738` ([`eas.json`](../../../eas.json))
- **Bundle Identifier (iOS / iPadOS)**: `com.beaversdamit.app` (`supportsTablet: true`, `orientation: landscape`)
- **Android Package**: `com.beaversdamit.app`
- **Web Dashboards**:
  - **Expo / EAS Dashboard (Builds, Logs, Artifacts)**: `https://expo.dev/accounts/tduerig/projects/beavertown/builds`
  - **Apple App Store Connect / TestFlight**: `https://appstoreconnect.apple.com/teams/54e42563-56f5-4b30-8c87-54f39412a81e/apps/6763405738/testflight/ios`
  - **Google Play Console**: `https://play.google.com/console`

---

## 1. Instant Live Testing on iPad & Android (Expo Go)
Because this project uses standard Expo SDK 54 modules (`expo-gl`, `expo-haptics`, `react-native-gesture-handler`, `react-native-reanimated`), you can test uncommitted changes immediately over Wi-Fi or tunnel without waiting for a cloud build:

1. Install **Expo Go** on your iPad (App Store) or Android device (Google Play).
2. Run the local Metro server:
   ```bash
   # Same Wi-Fi network (fastest):
   npx expo start

   # Or via ngrok tunnel if iPad/Android is on a different network/VLAN:
   npx expo start --tunnel
   ```
3. Scan the terminal QR code using the **iPad Camera app** (opens in Expo Go) or the **Expo Go app** on Android.

---

## 2. Pre-Flight Checklist Before Cloud Builds (EAS)
Before triggering an EAS cloud build (`eas build`):
1. **Run Unit & Benchmark Tests**:
   ```bash
   npx jest --config '{"transform":{"^.+\\.[jt]sx?$":"babel-jest"},"testEnvironment":"node"}' --watchAll=false src/store.test.ts src/benchmarks/renderLoopBounds.test.ts
   ```
2. **Bump Version Numbers in [`app.json`](../../../app.json)** (Note: [`eas.json`](../../../eas.json) sets `"appVersionSource": "local"` and `"autoIncrement": true` for `production`):
   - `npm run build:ios` and `npm run build:android` will automatically increment `expo.ios.buildNumber` and `expo.android.versionCode` on `production` builds.
   - Optionally increment `expo.version` (currently `"1.0.3"`).
3. **Verify EAS Authentication**:
   ```bash
   npx eas-cli whoami
   # If not logged in:
   npx eas-cli login
   ```

---

## 3. Pushing to iPad / iOS (TestFlight via EAS)
Apple requires signed builds for physical iPads outside of Expo Go. The fastest standalone distribution path is **TestFlight** using the `production` profile in [`eas.json`](../../../eas.json) (which is pre-configured with `ascAppId: "6763405738"` so no interactive Apple password/2FA is needed):

### Option A: Build & Submit (`npm run build:ios` & `npm run submit:ios`)
We added `build:ios` and `submit:ios` to [`package.json`](../../../package.json) with `EAS_NO_VCS=1` (which avoids macOS `/usr/bin/git` Xcode license shim errors and packages uncommitted working-tree files cleanly):
```bash
# 1. Queue the iOS build on EAS:
npm run build:ios

# 2. Once the build completes, submit the latest build to TestFlight non-interactively:
npm run submit:ios
```
*(Or do both in one step with `EAS_NO_VCS=1 npx --yes eas-cli build --platform ios --profile production --auto-submit --no-wait --non-interactive`.)*

### Option B: Post-Build TestFlight Steps
1. Monitor the build queue and logs at **`https://expo.dev/accounts/tduerig/projects/beavertown/builds`**.
2. Once submitted, open **`https://appstoreconnect.apple.com` -> Apps -> Beavers Dam It -> TestFlight**.
3. Wait ~5–10 minutes for Apple's "Processing" to complete (`ITSAppUsesNonExemptEncryption: false` is already configured in [`app.json`](../../../app.json), so export compliance is automatic).
4. Add your External/Internal Tester group to the build if needed, then open the **TestFlight** app on your iPad to install/update.
5. **Generate a Shareable TestFlight QR Code** (optional helper script):
   ```bash
   node scripts/generate_testflight_qr.mjs https://testflight.apple.com/join/<YOUR_CODE>
   ```
   This outputs `TestFlight_QR_Code.png` in the project root.

---

## 4. Pushing to Android (Direct APK or Play Store via EAS)

### Option A: Google Play Store AAB (`production` profile)
To build an Android App Bundle (`.aab`) for Google Play Internal/Closed testing or production (auto-increments `expo.android.versionCode` in [`app.json`](../../../app.json)):
```bash
npm run build:android
# Optional submit once finished:
npx eas-cli submit --platform android
```
*(Or download the resulting `.aab` from `https://expo.dev/accounts/tduerig/projects/beavertown/builds` and upload it to `https://play.google.com/console`.)*

### Option B: Direct Sideloadable APK (`preview` profile — Fastest for Android Devices)
The `preview` profile in [`eas.json`](../../../eas.json) is configured with `"buildType": "apk"` so you don't need Google Play review to install on an Android phone/tablet:
```bash
npm run build:android:apk
```
- When the build finishes, **EAS provides a direct download URL and QR code** on `https://expo.dev/accounts/tduerig/projects/beavertown/builds`.
- Scan the QR code on your Android device to download and install the `.apk` directly.

### Option C: Build Both iOS + Android Simultaneously
```bash
npx eas-cli build --platform all --profile production
```

---

## 5. Exporting Static Web Build
[`app.json`](../../../app.json) configures `"web": { "output": "static" }`. To build a static web bundle into `dist/`:
```bash
npx expo export --platform web
```
You can then deploy `dist/` to EAS Hosting (`npx eas-cli deploy`), Vercel, Netlify, or GitHub Pages.
