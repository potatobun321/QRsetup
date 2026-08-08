# JAI Conclave 2026 — Volunteer QR Scanner

Mobile-first PWA for volunteers to check in participants at event checkpoints (Entrance, Badge Collection, Lunch, Council, etc.). Hosted on GitHub Pages, backed by a Google Apps Script API in front of the EMD (Event Management Database) Google Sheet.

The browser **never** talks to Google Sheets directly — every read/write goes through the Apps Script API.

```
GitHub Pages (this app)
      ↓  fetch() — POST only
Google Apps Script Web App (API)
      ↓
Google Sheets (EMD)
```

---

## Live flow

```
Login → Select checkpoint → Scan QR → API → Result → Scan Next
```

- **Login**: Volunteer ID + 4-digit PIN. No cookies/sessions — the ID and PIN are stored on-device and sent with every request (per the backend's stateless design).
- **Checkpoint select**: one-tap, persists for the whole session.
- **Scan**: camera-based QR scan via [html5-qrcode](https://github.com/mebjas/html5-qrcode), or manual ID entry as a fallback.
- **Result**: full-screen colour-coded outcome — success (green), duplicate (amber), error (red), pending sync (amber/hourglass).
- **Offline**: scans are queued in IndexedDB and synced automatically once connectivity returns, using a `clientScanId` so retries can never double-count a check-in.

---

## File structure

```
index.html            Views: login, checkpoint select, scanner, result overlay, manual entry
css/style.css          Mobile-first dark theme, status colour coding
js/config.js            ← API_URL and app constants live here
js/api.js               fetch() wrapper — the only file that calls the backend
js/auth.js              Login + local session (volunteerId/PIN/checkpoints)
js/scanner.js           html5-qrcode camera integration
js/offlineQueue.js      IndexedDB queue + bulk sync/idempotent retry logic
js/ui.js                View switching, event wiring, result rendering — app entry point
manifest.json           PWA manifest (installable on Android home screen)
service-worker.js       Caches the app shell for offline loading; never caches API calls
icons/                  App icons (placeholders — replace with real branding anytime)
```

---

## Setup

### 1. Point the app at your backend

Open `js/config.js` and paste your deployed Apps Script Web App URL:

```js
API_URL: "https://script.google.com/macros/s/XXXXXXXXXXXX/exec",
```

This is the **only required change** to get a working build. No other secrets, PINs, Sheet IDs, or participant data belong in this repo — it's all public once pushed to GitHub Pages.

### 2. Push to GitHub

Put the contents of this folder at your repo root (or in `/docs`, whichever your Pages source uses):

```
your-repo/
  index.html
  manifest.json
  service-worker.js
  css/
  js/
  icons/
```

### 3. Enable GitHub Pages

Repo → **Settings → Pages** → Source: "Deploy from a branch" → pick your branch and folder → Save. The live URL appears on that same screen after the first build (~1 minute):

```
https://<username>.github.io/<repo>/
```

### 4. Test on Android

Open the live URL in **Chrome** on an Android phone (camera access requires HTTPS, which Pages provides). Use Chrome's menu → **Add to Home Screen** to install it as a standalone app icon.

---

## Redeploying updates

`git push` to your Pages branch — it rebuilds automatically. If you changed any cached file (HTML/CSS/JS/icons), **bump `APP_VERSION` in `js/config.js` first**:

```js
APP_VERSION: "v1.0.1",
```

The service worker's cache name is derived from this string, so a version bump forces phones to pull fresh files instead of serving a stale cached copy. If a device still looks stuck on an old version, clear the site's storage: Chrome → Site settings → the site → **Clear & reset**.

---

## API contract this app implements

All requests are `POST` to the single Apps Script URL, with an `action` field routing the request. See `js/api.js` for the exact request shapes and `js/ui.js` (`handleScanResponse`) for how each response `status` is handled:

| Action | Purpose |
|---|---|
| `login` | Volunteer ID + PIN → volunteer name + checkpoint list |
| `scan` | Single check-in submission |
| `bulkSync` | Replays queued offline scans |

| Status code | Meaning | UI behaviour |
|---|---|---|
| `SUCCESS` | Checked in | Green result screen |
| `DUPLICATE_SCAN` | Already scanned at this checkpoint | Amber result screen |
| `INVALID_ID` | Participant ID not found | Red result screen |
| `INVALID_CHECKPOINT` | Checkpoint unknown/inactive | Red result screen |
| `AUTH_FAILED` | Bad Volunteer ID/PIN or expired | Red screen, forces logout |
| `TIMEOUT` | Backend was locked (high traffic) | Queued for automatic retry |
| `ERROR` | Unexpected server error | Red result screen |

---

## Offline behaviour

- Every scan attempt is sent immediately if online.
- If the device is offline, or the request fails/times out, the scan is saved to an IndexedDB queue and the volunteer sees an optimistic "Saved — will sync" screen — scanning is never blocked.
- A background timer (every 15s by default, see `Config.SYNC_INTERVAL_MS`) and the browser's `online` event both trigger a sync attempt, sending queued scans in batches via `bulkSync`.
- Each queued scan carries a unique `clientScanId`. The backend treats this as an idempotency key, so a retried or duplicated sync can never create two check-in records for the same scan.
- The pending-sync count is shown as a badge in the top status bar.

---

## Known limitation / open item for the backend team

The API contract fully specifies the `bulkSync` response shape (`results[]` with per-item `status`), but the non-success response shape for the **single `scan`** action (e.g., what a `DUPLICATE_SCAN` response includes beyond `status`/`message`) wasn't fully pinned down. The frontend reads `participant` and `previousScan` fields defensively if present and degrades gracefully if not — worth confirming the exact shape so the duplicate screen can reliably show the original scan time.

---

## Support / non-technical volunteer notes

- Volunteers only ever need: their Volunteer ID, their 4-digit PIN, and which checkpoint they're at. Everything else is one-tap.
- The connectivity dot (top right) is green when online, amber when offline — volunteers don't need to understand why, just that amber means "still working, will catch up."
- "Enter ID manually" (below the camera view) is the fallback if a QR code won't scan (damaged print, glare, etc.).
# QRsetup
# QRsetup
