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
  API_URL: "https://script.google.com/macros/s/AKfycbwekPEm51lOi_3ofVDNK6I0GAJsd-n1r-vUst5sBYyuPKYoRj8HtUgfPVvmPV0n4uOk/exec",

  // Bump this string on every deploy that changes cached files.
  // The service worker uses it to know when to refresh its cache.
  APP_VERSION: "v1.0.1",

  // How long a scan result stays on screen before auto-returning
  // to the scanner (milliseconds). 0 disables auto-dismiss.
  RESULT_AUTO_DISMISS_MS: 2200,

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
