/**
 * config.js
 * ---------------------------------------------------------------
 * Single place to point the frontend at the backend.
 * No secrets, PINs, Sheet IDs, or participant data belong here —
 * this file is public (shipped to every browser on GitHub Pages).
 * ---------------------------------------------------------------
 */
const Config = {
  // PASTE your deployed Google Apps Script Web App URL below.
  // It looks like: https://script.google.com/macros/s/AKfycb.../exec
  API_URL: "https://script.google.com/macros/s/AKfycbyJHAdlC_tiuAlNLEN-c-epo3_S52GL66irYsui6A13jRWcy_J6xEQlbSmTyjCuK63R/exec",

  // Bump this string on every deploy that changes cached files.
  // The service worker uses it to know when to refresh its cache.
  APP_VERSION: "v1.1.1",

  // Fast auto-dismiss (1.2s) for high-throughput scanning queues.
  // Volunteers can also tap anywhere on the overlay to scan instantly.
  RESULT_AUTO_DISMISS_MS: 1200,

  // How many queued offline scans to send per bulkSync request.
  SYNC_BATCH_SIZE: 20,

  // How often (ms) to attempt a background sync of the offline queue.
  SYNC_INTERVAL_MS: 15000,

  // Network request timeout (ms) before treating a request as failed
  // and falling back to the offline queue.
  REQUEST_TIMEOUT_MS: 8000,

  // localStorage key for the saved session.
  SESSION_KEY: "emd_session_v1",
};
