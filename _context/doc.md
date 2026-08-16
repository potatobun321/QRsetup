# JAI Conclave 2026 — QR Scanning System
## Architecture & Implementation Design Document

---

## 1. Overall Architecture

### 1.1 Layered view

```
┌─────────────────────────────────────────────┐
│  GitHub Pages (Static Hosting)               │
│  index.html / app.js / style.css             │
│  - PWA manifest + service worker              │
└───────────────────┬───────────────────────────┘
                    │ HTTPS (fetch)
                    ▼
┌─────────────────────────────────────────────┐
│  Google Apps Script Web App (API Layer)       │
│  doGet() / doPost() → action router           │
│  - Auth check                                 │
│  - Validation                                 │
│  - Business logic                             │
│  - CacheService (in-memory lookup)            │
└───────────────────┬───────────────────────────┘
                    │ SpreadsheetApp
                    ▼
┌─────────────────────────────────────────────┐
│  Google Sheets — EMD                          │
│  Participants | Checkpoints | ScanLog |       │
│  Volunteers | Config                          │
└─────────────────────────────────────────────┘
```

### 1.2 Key architectural decision: GAS is single-endpoint

A GAS Web App only exposes **one URL**, with `doGet`/`doPost` as entry points. There is no native routing like Express. So the "API endpoints" described later are logically separate but physically implemented as **one dispatcher function** that reads an `action` field and routes to a handler. This is important context for section 4 — it explains why every request (GET or POST) carries an `action` parameter instead of hitting distinct URLs.

### 1.3 Data flow summary

1. Volunteer authenticates once (PIN → session token).
2. Volunteer selects checkpoint (persisted in app state for the session).
3. Camera scans QR → decodes Participant ID.
4. App calls `checkin` action with `{ participantId, checkpointId, volunteerToken }`.
5. Apps Script validates token, looks up participant, checks for duplicate, writes one row to `ScanLog`, returns JSON.
6. Frontend renders result full-screen with color/sound feedback.
7. If offline, the request is queued locally and retried automatically.

### 1.4 Why this separation matters

- **Browser never touches Sheets** → no service account keys or OAuth tokens exposed client-side.
- **All business logic centralized in Apps Script** → one place to change rules (e.g., "Lunch checkpoint allowed twice for Day 1 and Day 2") without redeploying the frontend.
- **Sheets stays the single source of truth**, but is shielded from concurrent raw writes by funneling everything through one script (Apps Script executions are effectively serialized per script by GAS's lock service, which also gives us a natural place to prevent race conditions on duplicate scans).

---

## 2. Frontend Structure

### 2.1 File/folder layout (GitHub Pages)

```
/docs (or root)
 ├── index.html          → Login screen
 ├── checkpoint.html      → Checkpoint selector
 ├── scan.html            → Camera scanner + result screen
 ├── /css
 │    └── style.css       → Mobile-first, large touch targets
 ├── /js
 │    ├── config.js        → API_BASE_URL, constants
 │    ├── api.js           → fetch wrapper, retry/queue logic
 │    ├── auth.js          → login, session token storage
 │    ├── scanner.js        → html5-qrcode integration
 │    ├── offlineQueue.js  → IndexedDB queue + sync
 │    └── ui.js            → render success/duplicate/error screens
 ├── /assets
 │    ├── icons/            → PWA icons
 │    └── sounds/           → success.mp3, error.mp3
 ├── manifest.json         → PWA manifest (installable "app")
 └── service-worker.js     → asset caching, offline shell
```

Single-page app (SPA)-style navigation using plain JS view toggling is preferable to multi-page navigation, since it avoids re-initializing the camera stream and keeps the session state in memory without relying on `sessionStorage` round-trips.

### 2.2 Screen flow

```
[Login: Name/PIN] → [Checkpoint select] → [Scanner view] → [Result overlay] → back to Scanner
```

- **Login screen**: volunteer name dropdown or PIN pad. No typing of long IDs — minimize friction for non-technical users.
- **Checkpoint select**: large buttons (Entrance / Badge / Lunch Day 1 / Lunch Day 2 / Council / Custom), one tap, stored for the whole session so it isn't reselected per scan.
- **Scanner view**: full-screen camera viewport using `html5-qrcode`, a persistent header showing volunteer name + checkpoint + online/offline indicator + pending-sync counter.
- **Result overlay**: full-screen colored flash (green = success, amber = duplicate, red = error/invalid) with large text, auto-dismiss after 2–3 seconds back to scanning, plus a manual "Scan Next" tap-to-dismiss for accessibility.

### 2.3 Mobile-first UI principles

- Minimum 48×48px touch targets.
- Large, high-contrast fonts (volunteers glance at the phone in bright/dark venues).
- Haptic vibration + sound cue on scan result (configurable, since some events want silence).
- No scrolling required on any screen — everything fits one viewport.
- Auto-restart scanning after each result (no extra tap needed in the common path).
- Dark mode by default (better battery life, better outdoor visibility, and less light pollution in evening sessions).

---

## 3. Google Apps Script API Design

### 3.1 Single dispatcher pattern

```
doGet(e)  → for read-only/idempotent calls (e.g., health check, checkpoint list)
doPost(e) → for all state-changing calls (login, checkin)
```

Both parse a JSON body (POST) or query params (GET), extract `action`, and route to a handler function. This keeps the script organized as:

```
Code.gs           → doGet/doPost, router
Auth.gs           → volunteer login, token validation
CheckIn.gs        → check-in business logic
Lookup.gs         → participant/checkpoint lookups, caching
Sheets.gs         → all direct Sheet read/write helpers (only file touching SpreadsheetApp)
Utils.gs          → response builders, error codes, logging
Config.gs         → constants, sheet names, column indices
```

Isolating all `SpreadsheetApp` calls inside `Sheets.gs` means the rest of the codebase never touches ranges/columns directly — reducing the risk of a rogue write and making future migration (e.g., to a proper database) far easier.

### 3.2 Handler responsibilities (per request)

Every handler follows the same pipeline:

1. **Parse & validate shape** — required fields present, correct types.
2. **Authenticate** — verify volunteer token (see §6).
3. **Authorize** — is this volunteer allowed to scan at this checkpoint (if checkpoint-level restrictions exist)?
4. **Business validation** — does the Participant ID exist? Is it a duplicate for this checkpoint?
5. **Mutate** — append one row to `ScanLog` (never edit the master `Participants` sheet during scanning).
6. **Respond** — structured JSON, always including a `status` field.

### 3.3 Sheet design (within the EMD spreadsheet)

| Sheet | Purpose | Written by |
|---|---|---|
| `Participants` | Master record (ID, Name, Email, Category, QR link) | Registration automation only |
| `Checkpoints` | Checkpoint ID, display name, active flag, allowed-repeat flag | Manually configured |
| `Volunteers` | Volunteer ID, name, PIN hash, assigned checkpoint(s), active flag | Manually configured |
| `ScanLog` | Append-only: ScanID, ParticipantID, CheckpointID, VolunteerID, Timestamp, Result | QR scanning system |
| `Config` | Feature flags, event day boundaries, duplicate-window rules | Manually configured |

Keeping `ScanLog` **append-only** (rather than updating a "status" cell on the `Participants` row) is deliberate: it avoids write contention on a shared row, gives a full audit trail per checkpoint, and lets duplicate-detection be a read (lookup) rather than a locking read-modify-write on the master sheet.

---

## 4. API Endpoints (logical, routed via `action`)

| Action | Method | Purpose |
|---|---|---|
| `login` | POST | Volunteer authenticates with name + PIN, receives session token |
| `getCheckpoints` | GET | Returns active checkpoint list for the selector screen |
| `checkin` | POST | Core scan action — validates and logs a check-in |
| `getParticipant` | GET | Optional manual lookup by ID (fallback if QR fails to scan) |
| `syncBatch` | POST | Accepts an array of queued offline scans for bulk replay |
| `ping` | GET | Lightweight health check for the offline/online indicator |

Each is implemented as a function in the corresponding `.gs` file, called from the router's switch/case on `action`.

---

## 5. JSON Request/Response Formats

### 5.1 `login`
Request:
```json
{
  "action": "login",
  "volunteerId": "V-014",
  "pin": "4821"
}
```
Response (success):
```json
{
  "status": "ok",
  "token": "b7e2f1c4-9a3d-...",
  "volunteerName": "Ritika Sharma",
  "assignedCheckpoints": ["ENTRANCE", "LUNCH1"],
  "expiresAt": "2026-08-15T23:59:00+05:30"
}
```
Response (failure):
```json
{ "status": "error", "code": "AUTH_INVALID_PIN", "message": "Incorrect PIN." }
```

### 5.2 `checkin`
Request:
```json
{
  "action": "checkin",
  "token": "b7e2f1c4-9a3d-...",
  "participantId": "JAI-26-000451",
  "checkpointId": "ENTRANCE",
  "clientTimestamp": "2026-08-15T09:18:03+05:30",
  "clientScanId": "a91c-local-uuid"
}
```
`clientScanId` is a UUID generated on-device — it is the idempotency key that makes offline replay safe (see §10).

Response — success:
```json
{
  "status": "success",
  "result": "CHECKED_IN",
  "participant": {
    "id": "JAI-26-000451",
    "name": "John Doe",
    "category": "Delegate"
  },
  "checkpoint": "Main Entrance",
  "serverTimestamp": "2026-08-15T09:18:05+05:30"
}
```
Response — duplicate:
```json
{
  "status": "success",
  "result": "DUPLICATE",
  "participant": { "id": "JAI-26-000451", "name": "John Doe" },
  "checkpoint": "Lunch Day 1",
  "previousScan": { "timestamp": "2026-08-15T09:02:11+05:30", "volunteer": "Aman K." }
}
```
Response — not found:
```json
{ "status": "error", "code": "PARTICIPANT_NOT_FOUND", "message": "No participant with this ID." }
```
Response — invalid/expired token:
```json
{ "status": "error", "code": "AUTH_EXPIRED", "message": "Session expired. Please log in again." }
```

### 5.3 `syncBatch`
Request:
```json
{
  "action": "syncBatch",
  "token": "b7e2f1c4-9a3d-...",
  "scans": [
    { "participantId": "JAI-26-000451", "checkpointId": "ENTRANCE", "clientTimestamp": "...", "clientScanId": "uuid-1" },
    { "participantId": "JAI-26-000452", "checkpointId": "ENTRANCE", "clientTimestamp": "...", "clientScanId": "uuid-2" }
  ]
}
```
Response:
```json
{
  "status": "ok",
  "results": [
    { "clientScanId": "uuid-1", "result": "CHECKED_IN" },
    { "clientScanId": "uuid-2", "result": "DUPLICATE" }
  ]
}
```

### 5.4 Standard envelope convention

Every response includes `status` (`ok` / `success` / `error`). Errors always include a machine-readable `code` (upper-snake-case) plus a human-readable `message`, so the frontend can branch on `code` while showing `message` (or a localized version of it) to the volunteer.

---

## 6. Authentication Between Frontend and Backend

Two layers of trust are needed: (a) that the caller is a legitimate volunteer, and (b) that the GAS endpoint itself isn't wide open to arbitrary internet traffic.

### 6.1 Volunteer-level auth (application layer)
- Volunteers log in with a **short numeric PIN** tied to their Volunteer ID (not their personal password — simple, event-specific, revocable).
- PINs are stored in the `Volunteers` sheet as **hashes** (e.g., SHA-256 with a per-event salt), never plaintext, computed once during setup.
- On successful login, Apps Script issues a **session token** (random UUID) and stores it in a `Sessions` sheet or in `CacheService`/`PropertiesService` with an expiry timestamp (e.g., valid for the event's duration, or 12–24 hours, refreshed on use).
- Every subsequent request carries this token; the backend validates it before doing anything else. This avoids sending the PIN on every request.

### 6.2 Transport-level auth (protecting the API surface)
- Deploy the Apps Script Web App with **"Execute as: Me"** and **"Who has access: Anyone"** (Apps Script web apps require this to be callable from a browser without Google login prompts — GAS does not support custom CORS headers well, so "Anyone with the link" is the practical option).
- To compensate for the API being technically reachable by anyone with the URL, add a **static shared secret** (`API_KEY`) baked into `config.js` and required on every request in addition to the volunteer token. This isn't strong cryptographic security (client-side JS is always inspectable) but it filters out casual scraping/bots and is standard practice for this kind of GAS deployment.
- Treat the Apps Script URL itself as semi-secret — don't publish it publicly beyond the frontend bundle.
- Real security here rests on **server-side validation of the volunteer token**, not on hiding the URL or key.

### 6.3 Why not full OAuth?
Full Google OAuth would require volunteers to sign into a Google account on their personal phones and would complicate the "walk up and use it" UX. A lightweight PIN + token scheme is the right trade-off for a short-lived, high-throughput event tool, provided the checkpoint-level authorization (§3.2) and audit logging (§9) compensate.

---

## 7. Security Considerations

- **Input validation**: every field (`participantId`, `checkpointId`, tokens) validated for format/pattern (e.g., `JAI-26-\d{6}`) before touching the sheet — rejects malformed or injected input immediately.
- **No formulas from user input**: never concatenate user-supplied strings into sheet formulas (avoids formula-injection into Sheets).
- **Rate limiting**: use `CacheService` to track request counts per token/IP-equivalent and throttle abusive bursts (e.g., >20 check-ins/second from one token is almost certainly a bug or misuse, not a real volunteer).
- **Locking on writes**: wrap the check-in write in Apps Script's `LockService.getScriptLock()` to serialize concurrent writes and prevent two simultaneous scans of the same participant from both being recorded as "first" (classic race condition on duplicate detection).
- **Least privilege**: the script's sheet-editing permissions are scoped to this one spreadsheet; no broader Drive/Gmail scopes requested for this particular Web App deployment (the existing registration automation can remain a separate, more privileged script).
- **Audit trail**: `ScanLog` is append-only and includes volunteer ID + timestamp on every row — supports post-event reconciliation and dispute resolution ("who scanned this and when").
- **PIN hygiene**: PINs are short-lived (rotate before the event), hashed at rest, and revocable by clearing a volunteer's row if a phone is lost.
- **HTTPS only**: both GitHub Pages and Apps Script Web Apps are HTTPS by default — no plaintext transport.
- **No sensitive data in QR codes**: QR encodes only the Participant ID, never PII directly, so a lost/photographed QR reveals nothing sensitive on its own.

---

## 8. Volunteer Login/Session Management

- **Login**: name/PIN → token issued (§6.1).
- **Session persistence**: token stored in `localStorage` (survives page reloads/app restarts, scoped to the device) along with the selected checkpoint and volunteer display name, so a volunteer doesn't have to re-login between scans.
- **Session expiry**: server-side expiry (e.g., end of event day) enforced on every request; on `AUTH_EXPIRED`, frontend clears local session and returns to the login screen.
- **Multi-device**: nothing prevents multiple volunteers being logged in on different phones simultaneously — sessions are independent per token.
- **Logout**: explicit "Switch volunteer" button clears local storage and invalidates the token server-side (delete from `Sessions`) — important for shared/pooled devices at the venue.
- **Checkpoint reassignment**: if a volunteer is moved between checkpoints mid-event, they simply reselect from the checkpoint screen (assuming `assignedCheckpoints` permits it, or admin updates the `Volunteers` sheet).

---

## 9. Error Handling

### 9.1 Error taxonomy (returned via `code`)

| Code | Meaning | Frontend behavior |
|---|---|---|
| `AUTH_INVALID_PIN` | Wrong PIN at login | Show inline error, allow retry |
| `AUTH_EXPIRED` / `AUTH_INVALID_TOKEN` | Session no longer valid | Force re-login |
| `PARTICIPANT_NOT_FOUND` | ID not in `Participants` | Red screen: "Not a valid registration — check with desk" |
| `CHECKPOINT_INVALID` | Unknown/inactive checkpoint | Red screen, prompt to reselect checkpoint |
| `VALIDATION_ERROR` | Malformed request | Generic red screen + auto-log for debugging |
| `RATE_LIMITED` | Too many requests too fast | Brief cooldown message |
| `SERVER_ERROR` | Unexpected exception in Apps Script | Generic red screen, request queued for retry if applicable |
| `NETWORK_ERROR` (client-side, not from server) | Fetch failed / no connectivity | Auto-queue offline (§10), amber "saved, will sync" indicator |

### 9.2 Principles

- Every Apps Script handler wraps its logic in `try/catch`; unhandled exceptions are caught centrally in the router and converted to a `SERVER_ERROR` JSON response rather than leaking an HTML stack trace (GAS's default error page is not valid JSON and would break the frontend's parser).
- The frontend never shows a blank/frozen screen — every failure path resolves to a clear, color-coded, large-text message within ~1 second, with an obvious next action (retry, reselect checkpoint, re-login).
- All errors (client and server) are logged with enough context (volunteer, checkpoint, participant ID, timestamp) to reconstruct incidents after the event.

---

## 10. Offline Behaviour and Recovery

Venue Wi-Fi/cellular is often unreliable — this is one of the most important parts of the design.

### 10.1 Detection
- `navigator.onLine` plus periodic `ping` calls (§4) to distinguish "device thinks it's online but the API is unreachable" from true offline.
- Persistent header indicator: green dot (online, synced), amber dot (offline/queued, with count), so volunteers always know the state without needing to understand why.

### 10.2 Queueing
- Every `checkin` request is first written to a local **IndexedDB** queue (more reliable and higher-capacity than `localStorage` for this) with a client-generated `clientScanId` (UUID) **before** attempting the network call.
- If the network call succeeds, the queue entry is marked synced and removed. If it fails (offline or timeout), it stays queued and the UI still shows an optimistic "Saved — will sync" result to the volunteer, so scanning is never blocked.

### 10.3 Optimistic local duplicate check
- The app also keeps a lightweight local cache (downloaded at login, or built up as scans happen this session) of `{participantId+checkpointId}` pairs already scanned **on this device**, so it can warn "possible duplicate" even while offline — with the caveat that true duplicate detection across *all* devices only happens once synced.

### 10.4 Sync/replay
- A background sync loop (interval timer, and triggered on `online` event) POSTs queued items via `syncBatch` (§5.3) in small batches (e.g., 20 at a time) to avoid oversized payloads.
- **Idempotency**: the server treats `clientScanId` as unique — if the same `clientScanId` is submitted twice (e.g., retried after a timeout where the first request actually succeeded), the server returns the original result instead of creating a duplicate log row. This is the key mechanism that makes retries and offline replay safe.
- Conflict case — two different devices scanned the same participant at the same checkpoint while both offline: when both sync, the server's authoritative check (by `participantId`+`checkpointId`, not by device) marks the second as `DUPLICATE` with the actual first server-recorded timestamp, and the frontend on that second device shows the duplicate screen retroactively (or, if scanning has already moved on, surfaces it in a "sync issues" review list for the admin).

### 10.5 Service worker
- Caches the app shell (HTML/CSS/JS, the QR library, icons) so the app **loads and the camera works even with zero connectivity** — only the final `checkin` network call depends on connectivity, and that's queued as above.

---

## 11. Performance for 500–3000 Participants

At this scale, the main risks are (a) slow participant lookups if the script re-reads the whole sheet per scan, and (b) too many small writes causing quota/latency issues.

- **In-memory lookup via `CacheService`**: on first request (or on a scheduled trigger), build a `participantId → {name, category}` map from the `Participants` sheet once, and store it in `CacheService` (6-hour max TTL, refreshed as needed) or `PropertiesService` for longer-lived data. Subsequent lookups are O(1) cache reads instead of `Sheet.getDataRange()` scans — this is the single biggest performance lever.
- **Avoid `getRange`/`getValues` per request where possible**: batch-read once per script execution if a fresh read is unavoidable, never loop `getCell()` calls.
- **Append, don't search-and-update, for logging**: writing a new `ScanLog` row via `appendRow()` is O(1); the only lookup needed is a cache/dictionary check for "does this participant+checkpoint pair already exist" (built the same way as the participant cache, keyed as `participantId::checkpointId`, refreshed incrementally as scans come in during the same execution context via `CacheService`).
- **`LockService`** ensures correctness under concurrency without needing to serialize *reads* — only the brief write section is locked, keeping throughput high even with many volunteers scanning simultaneously.
- **Expected load**: even at 3000 participants scanning across 5 checkpoints (~15,000 scan events total), Apps Script's write throughput (roughly single-digit writes/second sustained) is comfortably sufficient if writes are simple appends and lookups are cache-backed — the realistic bottleneck is Apps Script's per-execution and per-day quota, not raw data volume.
- **Batch sync amplification**: offline batch replays (§10.4) should be chunked (e.g., 20–50 scans per `syncBatch` call) to stay well within Apps Script's execution time limit (6 minutes per execution) and response size norms.
- **Sheet hygiene**: keep `ScanLog` as a plain append-only table with no volatile formulas (e.g., no live `=VLOOKUP` recalculating on every row) — volatile formulas recalculate on every edit and can noticeably slow down large sheets during a live event.

---

## 12. Deployment Strategy

### 12.1 Environments
Maintain **two Apps Script deployments** from the same script project:
- **Test deployment** (a separate spreadsheet copy with dummy participants) — used for UAT with actual volunteer phones before the event.
- **Production deployment** — pointed at the real EMD spreadsheet, deployed only after test sign-off.

Correspondingly, `config.js` on the frontend has a `TEST_API_URL` / `PROD_API_URL` toggle (or better, separate branches/build outputs) so it's never possible to accidentally point the live app at the test backend or vice versa.

### 12.2 Apps Script deployment mechanics
- Use **versioned deployments** ("Manage deployments" → new version on each release) rather than "Head" so a bad script change doesn't immediately break the live event — you can roll back to a known-good version instantly.
- Deploy with **Execute as: Me**, **Who has access: Anyone** (see §6.2), and record the deployment URL in a shared, access-controlled doc (not committed publicly if avoidable — though for a GitHub Pages frontend it will necessarily be visible in client-side JS; the shared-secret in §6.2 is the mitigation).

### 12.3 GitHub Pages
- Serve from a `docs/` folder or `gh-pages` branch on the existing repo (consistent with the current frontend setup).
- Add a `manifest.json` + `service-worker.js` so volunteers can **"Add to Home Screen"** on Android for a native-app-like icon and offline shell loading — reduces reliance on typing a URL and improves reliability.
- Use a `?v=` cache-busting query param (or filename hashing) on JS/CSS during rollout so volunteer phones pick up updates rather than serving a stale cached bundle mid-event.

### 12.4 Pre-event checklist
- Load-test with a batch of dummy scans against the test deployment.
- Verify camera permissions flow on actual Android devices/browsers volunteers will use (Chrome recommended; confirm HTTPS is enforced, since camera access requires a secure context).
- Confirm offline queue → sync round-trip works with airplane mode toggling.
- Pre-brief volunteers with a 2-minute walkthrough (login → checkpoint → scan) — the UI should make this close to unnecessary, but a fallback laminated quick-guide is good practice.
- Have a designated "admin" phone/account with visibility into `ScanLog` for real-time monitoring (Google Sheets itself, viewed live, is sufficient here — no separate dashboard needed for v1).

### 12.5 Rollback plan
Since Sheets is the source of truth and `ScanLog` is append-only, rollback is low-risk: reverting the Apps Script deployment version or the frontend commit doesn't corrupt historical data — worst case is a short gap in service, recoverable via the offline queue.

---

## 13. Future Extensibility

The design leaves clear extension points without requiring architectural rework:

- **Additional checkpoints**: purely a data change (`Checkpoints` sheet) — no code change needed.
- **Role-based volunteer permissions**: `Volunteers.assignedCheckpoints` already supports restricting a volunteer to specific checkpoints; could extend to admin-only actions (manual override, re-open a checkpoint).
- **Live analytics dashboard**: a simple read-only `getStats` action (counts per checkpoint, hourly throughput) can be added later, either as an admin web view or by charting directly off the `ScanLog` sheet in Google Sheets/Looker Studio.
- **Badge/ID printing integration**: `checkin` response already returns participant name/category, which could trigger a connected label printer via a bridge app if needed for a later phase.
- **Multi-event reuse**: `Config` sheet + a top-level `eventId` on requests would let the same script/frontend serve multiple events by swapping the target spreadsheet — turning this into a reusable internal tool rather than a one-off.
- **Push notifications**: PWA infrastructure (manifest + service worker) already in place, so web push for volunteer coordination ("Lunch checkpoint closing in 10 minutes") is a natural add-on.
- **Migration off Sheets**: because all sheet access is isolated in `Sheets.gs` (§3.1), a future migration to a proper database (Firebase, PostgreSQL via a small backend) would only require rewriting that one file's internals — the API contract (§5) and frontend stay unchanged.
- **QR payload versioning**: encoding a short version prefix in the QR content (e.g., `v1:JAI-26-000451`) now costs nothing and avoids breaking already-issued/printed passes if the ID scheme evolves later.

---

## Summary

This design keeps the browser as a thin, offline-tolerant client; centralizes every rule and validation inside Apps Script; treats Google Sheets as an append-mostly audit log rather than a live-updated record per scan; and uses lightweight PIN/token auth appropriate for a short-lived event tool rather than over-engineering full OAuth. The result should comfortably handle 500–3000 participants across multiple checkpoints on ordinary Android phones, degrade gracefully under poor connectivity, and remain simple enough for non-technical volunteers to use with near-zero training.

Ready to move into implementation whenever you'd like — a sensible build order would be: (1) Sheets schema + Apps Script skeleton with `login`/`checkin`, (2) frontend login + checkpoint + scanner screens against the test deployment, (3) offline queue + sync, (4) polish/PWA/deployment hardening.
