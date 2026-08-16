SYSTEM CONTEXT & BACKEND ARCHITECTURE BRIEF

Project: JAI Conclave 2026 Event Management System (Scanner Webhook & Frontend Integration)

Role: You are acting as the Frontend/Mobile App Developer. I am providing the Backend Architecture.1. System Overview

We have built a lightweight, highly scalable, zero-cost Event Management Database (EMD) entirely on Google Workspace (Google Sheets + Google Apps Script). The backend is 100% complete and deployed as a Google Apps Script Web App.

Your job is to review, build, or refine the Frontend Scanner App (HTML/JS/PWA) that volunteers will use on their phones to scan participant QR codes.2. Database Architecture (Google Sheets)

The backend database is highly normalized to prevent concurrency issues and protect data integrity. It consists of the following sheets:

    00_Configuration: Stores global variables, active Checkpoints (e.g., Main Entrance, Lunch), and Volunteer Auth credentials (ID, Name, PIN, Active status).
    01_Participants_Master: Immutable list of verified participants.
    02_Operational_State: Contains live state (Last Scan, Meals Claimed, Email Status). It uses MAP/LAMBDA formulas to derive live data directly from the Activity Log. (Note: We explicitly removed Certificate generation from this system).
    03_Activity_Log: The single source of truth. An append-only ledger of every physical scan. Google Sheets handles simultaneous row appends natively, solving concurrency issues.
    04_Admin_Actions: Log for manual overrides.
    05_Automation_Log: Logs backend script executions.
    06_Live_Dashboard: Real-time analytics using QUERY formulas.

3. The API Contract (Google Apps Script Webhook)

The frontend communicates with the backend via a single Google Apps Script Web App URL.

    Method: POST only (Google Apps Script doGet does not accept JSON bodies).
    Content-Type: The frontend MUST use Content-Type: text/plain;charset=utf-8 and redirect: "follow" in its fetch() request to avoid Google's strict CORS preflight blocks.
    Stateless: The API is stateless. Every request must include the volunteerId and pin.
    Routing: The payload must include an "action" key ("login", "scan", or "bulkSync").

4. Action Payloads & Expected Behavior

A. Action: "login"

    Frontend sends: volunteerId, pin
    Backend does: Validates against 00_Configuration. Returns SUCCESS with the volunteer's name and an array of active Checkpoints.

B. Action: "scan"

    Frontend sends: volunteerId, pin, payload (containing participantId, checkpointId, clientScanId, timestamp).
    Backend does:
        Validates auth.
        Uses LockService to prevent race conditions.
        Validates the participantId exists.
        Validates the checkpointId is active.
        Duplicate Check: If the checkpoint configuration says Duplicate_Allowed = FALSE, it checks the 03_Activity_Log. If the participant was already scanned there, it returns a DUPLICATE_SCAN error.
        Appends the scan to 03_Activity_Log.

C. Action: "bulkSync"

    Frontend sends: An array of scan payloads stored while the device was offline.
    Backend does: Iterates through the array and processes them exactly like single scans, returning an array of results.

5. Idempotency & Offline Queueing (CRITICAL)

The frontend MUST support offline scanning.

    For every scan, the frontend generates a unique UUIDv4 called clientScanId.
    If the frontend loses internet, it queues the scans locally (e.g., IndexedDB).
    When internet returns, it sends them via "bulkSync".
    Idempotency: If the backend receives a scan, it checks the 03_Activity_Log for that exact clientScanId. If it already exists, the backend safely ignores the write and returns SUCCESS. This allows the frontend to safely retry failed network requests without double-logging participants.

6. QR Code Design

    QR codes contain ONLY the Participant ID in plain text (e.g., JAI-26-000001).
    They do NOT contain URLs or PII. The frontend scanner simply reads this string and passes it to the API.

Task for the AI: Review the provided Apps Script codebase to understand the exact JSON response structures (e.g., success, status, message). Ensure the frontend scanner app correctly handles the SUCCESS, DUPLICATE_SCAN, INVALID_ID, INVALID_CHECKPOINT, AUTH_FAILED, and TIMEOUT statuses.
