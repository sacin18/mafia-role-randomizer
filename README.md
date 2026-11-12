# Mafia Role Randomizer & Game Hub (Native Android, iOS & Offline Hotspot Web App)

A complete, self-contained Mafia role randomizer and game management app designed for low-signal / no-internet mobile hotspot play.

## Seamless Native Mobile Apps (No Terminal or Pydroid Needed)

Both the **Native Android App** (`android/`) and **Native iOS App** (`ios/`) embed their own zero-dependency HTTP + RFC 6455 WebSocket server inside the app on port `8080`:
- **Open & Host Immediately**: Whoever opens the app on their phone automatically starts the local hotspot server in the background (`0.0.0.0:8080`), keeps the phone awake while players join in the Lobby, and opens the full-screen Mafia Hub interface.
- **Shareable with Any Host**: You can share the compiled `MafiaHub.apk` (Android) or install the iOS app via Xcode, and anyone can become the Game-God host just by opening the app and turning on their Wi-Fi Hotspot.
- **Other Players Don't Even Need the App**: Players joining the host's hotspot can either open the app OR simply visit `http://<host-hotspot-ip>:8080` in Chrome/Safari on their phones.

---

### How to Build the Native Apps

#### 1. Automatic 1-Click Cloud Build (GitHub Actions — Zero Local Setup)
Push this repository to GitHub. The workflow in [.github/workflows/build-mobile.yml](file:///Users/sacin/Documents/proj-codes/mafia-role-randomizer/.github/workflows/build-mobile.yml) automatically builds:
- **`MafiaHub-Android-APK`** (`app-release.apk` & `app-debug.apk`) ready to download from the GitHub Actions **Artifacts** tab and share via WhatsApp, Nearby Share, AirDrop, or Google Drive.
- **Native iOS Build** verified with `xcodebuild`.

#### 2. Building Locally in Android Studio (`android/`)
1. Run `python3 sync-assets.py` to ensure the latest web UI files are synced into the mobile bundles.
2. Open the [android/](file:///Users/sacin/Documents/proj-codes/mafia-role-randomizer/android) folder in **Android Studio**.
3. Click **Build -> Build Bundle(s) / APK(s) -> Build APK(s)** to generate `app-release.apk`.

#### 3. Building Locally in Xcode (`ios/`)
1. Run `python3 sync-assets.py`.
2. Open [ios/MafiaHub.xcodeproj](file:///Users/sacin/Documents/proj-codes/mafia-role-randomizer/ios/MafiaHub.xcodeproj) in **Xcode**.
3. Select your iPhone under **Signing & Capabilities** (free Apple ID works) and click **Run (▶)**.

---

### Desktop / Laptop Fallback Server
You can also run the standalone Python server on any laptop or desktop without installing any packages:
```bash
python3 server.py
```
