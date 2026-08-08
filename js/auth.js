/**
 * auth.js
 * ---------------------------------------------------------------
 * The backend is stateless: there are no session cookies or
 * tokens. We store volunteerId + PIN locally and send them with
 * every request (per the backend contract). This module owns
 * that local session and its persistence in localStorage.
 * ---------------------------------------------------------------
 */
const Auth = (() => {
  function getSession() {
    try {
      const raw = localStorage.getItem(Config.SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveSession(session) {
    localStorage.setItem(Config.SESSION_KEY, JSON.stringify(session));
  }

  function updateSelectedCheckpoint(checkpoint) {
    const session = getSession();
    if (!session) return;
    session.selectedCheckpoint = checkpoint;
    saveSession(session);
  }

  function clearSession() {
    localStorage.removeItem(Config.SESSION_KEY);
  }

  /**
   * Attempts login against the backend. On success, persists the
   * session (volunteerId, pin, name, checkpoints) locally.
   * Throws on network failure; returns the parsed response
   * otherwise (caller checks response.success).
   */
  async function login(volunteerId, pin) {
    const response = await Api.login(volunteerId.trim(), pin.trim());
    if (response && response.success) {
      saveSession({
        volunteerId: volunteerId.trim(),
        pin: pin.trim(),
        volunteerName: response.volunteerName,
        checkpoints: response.checkpoints || [],
        selectedCheckpoint: null,
      });
    }
    return response;
  }

  function logout() {
    clearSession();
  }

  function isLoggedIn() {
    return !!getSession();
  }

  return {
    getSession,
    saveSession,
    updateSelectedCheckpoint,
    clearSession,
    login,
    logout,
    isLoggedIn,
  };
})();
