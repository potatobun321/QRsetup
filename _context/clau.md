Here is the Backend Architecture Brief. You can copy and paste this entire response directly to Claude.

-----

# Backend Architecture Brief for Frontend PWA (GitHub Pages)

**To: Claude (Frontend Lead)**
**From: Gemini (Backend/Database Lead)**

Hello Claude. I am managing the backend and database for the JAI Conclave 2026 Event Management System. You are responsible for building the frontend mobile QR scanner (PWA on GitHub Pages).

This document is our strict API contract and backend specification. Please build the frontend architecture around these fixed parameters.

## 1\. Current State & Infrastructure

  * **Database:** Google Sheets (Event Management Database - EMD).
  * **Backend API:** Google Apps Script (GAS) deployed as a Web App.
  * **Already Implemented:** Participant ID generation (Format: `JAI-26-000001`) and QR Code generation. QR codes contain *only* the Participant ID in plain text.
  * **Fixed Sheets:**
      * `00_Configuration` (Checkpoints, System Variables, Volunteer Auth)
      * `01_Participants_Master` (Immutable participant details)
      * `02_Operational_State` (Derived statuses, Drive URLs)
      * `03_Activity_Log` (Append-only ledger of all physical scans)
      * `04_Admin_Actions`, `05_Automation_Log`, `06_Live_Dashboard`

## 2\. Backend Role & Sheet Mapping

The GAS backend acts as a stateless REST-like API. It bridges your JSON requests to the Google Sheets database.

  * **Reads:** The backend reads `00_Configuration` to validate Checkpoints and Volunteer PINs. It reads `01_Participants_Master` to validate scanned IDs and fetch basic display info (Name/Track). It reads `03_Activity_Log` to check for duplicates.
  * **Writes:** The backend *only* writes to `03_Activity_Log` during standard scan operations. It uses append-only operations to avoid concurrency collisions.

## 3\. Volunteer Authentication & Sessions

  * **Representation:** Volunteers are configured in `00_Configuration` with a `Volunteer_ID` (e.g., `VOL-01`), a `Name`, and a 4-digit `PIN`.
  * **Session Management:** The backend is stateless. There are no session cookies. You must store the `Volunteer_ID` and `PIN` locally (IndexedDB/localStorage) upon login and include them in the payload of *every* API request.

## 4\. API Endpoint & Routing Model

  * **Endpoint:** A single Google Apps Script Web App URL.
  * **Routing:** Because GAS `doGet` does not accept JSON bodies, **ALL requests must be HTTP POST requests**.
  * **Action Routing:** Every request must include an `action` key in the JSON payload (e.g., `action: "login"`, `action: "sync"`).

## 5\. Idempotency & Offline Synchronization

  * **`clientScanId`:** For every scan, your frontend must generate a unique UUID v4 (`clientScanId`).
  * **Idempotency:** If the backend receives a payload with a `clientScanId` that already exists in the `03_Activity_Log`, it will safely ignore the insertion and return a `SUCCESS` response. This allows you to safely retry failed network requests or process offline queues without fear of double-logging.
  * **Offline Queue:** Store offline scans in IndexedDB. When connectivity is restored, send them via the `bulkSync` action.

## 6\. Scan Validation & Duplicate Detection

When a scan is submitted, the backend performs the following synchronous checks:

1.  **Auth Check:** Validates Volunteer ID and PIN.
2.  **ID Check:** Ensures the Participant ID exists in `01_Participants_Master`.
3.  **Checkpoint Check:** Ensures the Checkpoint ID exists and is marked `Active = TRUE` in `00_Configuration`.
4.  **Duplicate Check:** If the Checkpoint has `Duplicate_Allowed = FALSE` (e.g., Badge Collection, Meals), the backend scans `03_Activity_Log`. If the Participant ID + Checkpoint ID combination already exists, the scan is rejected as a duplicate.

## 7\. Concurrency & Performance

  * **LockService:** The backend uses Google's `LockService` to prevent race conditions (e.g., two volunteers scanning the same badge at the exact same millisecond).
  * **Timeouts:** If the backend is locked for too long, it will return a `TIMEOUT` status. Your frontend should silently retry or alert the user to try again.
  * **Performance:** The EMD will hold up to 3,000 participants. Bulk syncing is highly preferred over firing 50 simultaneous individual POST requests when reconnecting to Wi-Fi.

## 8\. Data Exposure Constraints

  * **SAFE to return to frontend:** Participant Name, Track (e.g., Council/Mint), Sub-Track, and Scan Status. This is strictly for visual confirmation on the scanner UI.
  * **NEVER expose:** Full participant lists, Email addresses, Phone numbers, internal admin remarks, or any data of participants not explicitly scanned in that moment. Do not ask the backend to "dump" the database for offline validation. Offline validation is not permitted; all validation must happen server-side or be queued.

-----

## 9\. API JSON Contracts (Strict Formats)

Claude, please construct your API service to match these exact request/response formats. All responses will have an HTTP 200 status; you must read the JSON `success` boolean and `status` string to determine the outcome.

### A. Login / Fetch Configuration

**Request:**

``` json
{
  "action": "login",
  "volunteerId": "VOL-01",
  "pin": "1234"
}

```

**Response:**

``` json
{
  "success": true,
  "status": "SUCCESS",
  "volunteerName": "John Doe",
  "checkpoints": [
    { "id": "ENT", "name": "Main Entrance", "active": true },
    { "id": "BAD", "name": "Badge Collection", "active": true }
  ]
}

```

### B. Single Scan Submission (Live)

**Request:**

``` json
{
  "action": "scan",
  "volunteerId": "VOL-01",
  "pin": "1234",
  "payload": {
    "participantId": "JAI-26-000001",
    "checkpointId": "ENT",
    "clientScanId": "550e8400-e29b-41d4-a716-446655440000",
    "timestamp": "2026-08-08T09:00:00.000Z"
  }
}

```

**Response (Success):**

``` json
{
  "success": true,
  "status": "SUCCESS",
  "message": "Checked into Main Entrance",
  "participant": {
    "name": "Jane Smith",
    "track": "Council"
  }
}

```

### C. Bulk Sync (Offline Queue Recovery)

**Request:**

``` json
{
  "action": "bulkSync",
  "volunteerId": "VOL-01",
  "pin": "1234",
  "payload": [
    {
      "participantId": "JAI-26-000002",
      "checkpointId": "ENT",
      "clientScanId": "123e4567-e89b-12d3-a456-426614174000",
      "timestamp": "2026-08-08T09:05:00.000Z"
    },
    {
      "participantId": "JAI-26-000002",
      "checkpointId": "BAD",
      "clientScanId": "987e6543-e21b-34d3-b456-426614174111",
      "timestamp": "2026-08-08T09:06:00.000Z"
    }
  ]
}

```

**Response:**

``` json
{
  "success": true,
  "status": "SYNC_COMPLETE",
  "results": [
    { "clientScanId": "123e4567-e89b-12d3-a456-426614174000", "status": "SUCCESS" },
    { "clientScanId": "987e6543-e21b-34d3-b456-426614174111", "status": "DUPLICATE_SCAN" }
  ]
}

```

### 10\. Standard Status Codes (To be handled by Frontend UI)

  * `SUCCESS`: Scan recorded successfully (Green screen).
  * `DUPLICATE_SCAN`: Participant already scanned at this checkpoint, and duplicates are not allowed (Red screen/Warning).
  * `INVALID_ID`: Participant ID not found in database (Red screen).
  * `INVALID_CHECKPOINT`: Checkpoint doesn't exist or is closed (Red screen).
  * `AUTH_FAILED`: Invalid Volunteer ID or PIN (Force logout).
  * `TIMEOUT`: Backend locked due to high traffic (Auto-retry or prompt user).
  * `ERROR`: General server exception.

-----

*End of Brief. Claude, please confirm you understand these constraints and are ready to design the frontend architecture around this API endpoints around this API contract.*

