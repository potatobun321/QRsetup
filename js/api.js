/**
 * api.js
 * ---------------------------------------------------------------
 * Talks to the single Google Apps Script Web App endpoint.
 * ALL requests are POST with an `action` field, per the backend
 * contract (GAS doGet can't accept JSON bodies). The browser
 * NEVER talks to Google Sheets directly — this file is the only
 * place that knows the API URL.
 * ---------------------------------------------------------------
 */
const Api = (() => {
  async function post(body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Config.REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(Config.API_URL, {
        method: "POST",
        redirect: "follow",
        // Apps Script Web Apps don't handle a preflighted application/json
        // request well from all setups; text/plain avoids a CORS preflight
        // while the body itself is still valid JSON, which GAS parses fine
        // via e.postData.contents on the server side.
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  }

  function login(volunteerId, pin) {
    return post({ action: "login", volunteerId, pin, deviceId: Auth.getDeviceId() });
  }

  function scan(volunteerId, pin, payload) {
    return post({ action: "scan", volunteerId, pin, payload, deviceId: Auth.getDeviceId() });
  }

  function bulkSync(payloadArray) {
    // Uses the currently logged-in session, so callers (like
    // OfflineQueue) don't need to know session details themselves.
    const session = Auth.getSession();
    if (!session) return Promise.reject(new Error("No active session"));
    return post({
      action: "bulkSync",
      volunteerId: session.volunteerId,
      pin: session.pin,
      payload: payloadArray,
      deviceId: session.deviceId || Auth.getDeviceId(),
    });
  }

  function getDashboardStats() {
    const session = Auth.getSession();
    if (!session) return Promise.reject(new Error("No active session"));
    return post({
      action: "getDashboardStats",
      volunteerId: session.volunteerId,
      pin: session.pin,
      deviceId: session.deviceId || Auth.getDeviceId()
    });
  }

  function getVolunteerDevices() {
    const session = Auth.getSession();
    if (!session) return Promise.reject(new Error("No active session"));
    return post({
      action: "getVolunteerDevices",
      volunteerId: session.volunteerId,
      pin: session.pin,
      deviceId: session.deviceId || Auth.getDeviceId()
    });
  }

  function unlockVolunteerDevice(targetVolunteerId, unlockAction = "allowBackup") {
    const session = Auth.getSession();
    if (!session) return Promise.reject(new Error("No active session"));
    return post({
      action: "unlockVolunteerDevice",
      volunteerId: session.volunteerId,
      pin: session.pin,
      targetVolunteerId: targetVolunteerId,
      unlockAction: unlockAction,
      deviceId: session.deviceId || Auth.getDeviceId()
    });
  }

  return { login, scan, bulkSync, getDashboardStats, getVolunteerDevices, unlockVolunteerDevice };
})();
