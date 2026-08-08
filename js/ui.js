/**
 * ui.js
 * ---------------------------------------------------------------
 * Ties everything together: view navigation, wiring up forms and
 * buttons, driving the scanner, and rendering results/errors.
 * This is the app's entry point (UI.init() is called from index.html).
 * ---------------------------------------------------------------
 */
const UI = (() => {
  let els = {};
  let syncTimer = null;
  let dismissTimer = null;

  function cacheEls() {
    els = {
      statusBar: document.getElementById("statusBar"),
      volunteerName: document.getElementById("volunteerName"),
      checkpointName: document.getElementById("checkpointName"),
      pendingBadge: document.getElementById("pendingBadge"),
      connDot: document.getElementById("connDot"),
      logoutBtn: document.getElementById("logoutBtn"),
      changeCpBtn: document.getElementById("changeCpBtn"),

      viewLogin: document.getElementById("view-login"),
      loginForm: document.getElementById("loginForm"),
      volunteerIdInput: document.getElementById("volunteerId"),
      pinInput: document.getElementById("pin"),
      loginBtn: document.getElementById("loginBtn"),
      loginError: document.getElementById("loginError"),
      loginErrorBox: document.getElementById("loginErrorBox"),
      resetCacheBtn: document.getElementById("resetCacheBtn"),

      viewCheckpoint: document.getElementById("view-checkpoint"),
      checkpointList: document.getElementById("checkpointList"),

      viewScanner: document.getElementById("view-scanner"),
      manualEntryBtn: document.getElementById("manualEntryBtn"),

      resultOverlay: document.getElementById("resultOverlay"),
      resultIcon: document.getElementById("resultIcon"),
      resultTitle: document.getElementById("resultTitle"),
      resultName: document.getElementById("resultName"),
      resultId: document.getElementById("resultId"),
      resultCheckpoint: document.getElementById("resultCheckpoint"),
      resultTimeLabel: document.getElementById("resultTimeLabel"),
      resultTime: document.getElementById("resultTime"),
      scanNextBtn: document.getElementById("scanNextBtn"),

      manualModal: document.getElementById("manualEntryModal"),
      manualIdInput: document.getElementById("manualIdInput"),
      manualCancelBtn: document.getElementById("manualCancelBtn"),
      manualSubmitBtn: document.getElementById("manualSubmitBtn"),
    };
  }

  function showView(name) {
    ["viewLogin", "viewCheckpoint", "viewScanner"].forEach((k) => els[k].classList.add("hidden"));
    els[name].classList.remove("hidden");
    els.statusBar.classList.toggle("hidden", name === "viewLogin");
  }

  /* ---------------- Login ---------------- */

  function wireLogin() {
    els.loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const volunteerId = els.volunteerIdInput.value.trim();
      const pin = els.pinInput.value.trim();
      if (!volunteerId || !pin) return;

      setLoginLoading(true);
      if (els.loginErrorBox) els.loginErrorBox.classList.add("hidden");

      try {
        const res = await Auth.login(volunteerId, pin);
        if (res && res.success) {
          if (els.loginErrorBox) els.loginErrorBox.classList.add("hidden");
          goToCheckpointOrScanner();
        } else {
          showLoginError((res && res.message) || "Login failed. Check ID and PIN.");
        }
      } catch (err) {
        showLoginError("Can't reach server. If you recently updated, tap 'Clear Cache & Refresh'.");
      } finally {
        setLoginLoading(false);
      }
    });

    if (els.resetCacheBtn) {
      els.resetCacheBtn.addEventListener("click", async () => {
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (let reg of registrations) {
            await reg.unregister();
          }
        }
        if ('caches' in window) {
          const keys = await caches.keys();
          for (let k of keys) {
            await caches.delete(k);
          }
        }
        localStorage.clear();
        window.location.reload(true);
      });
    }
  }

  function setLoginLoading(loading) {
    els.loginBtn.disabled = loading;
    els.loginBtn.textContent = loading ? "Authenticating…" : "Sign In & Scan";
  }

  function showLoginError(msg) {
    els.loginError.textContent = msg;
    if (els.loginErrorBox) {
      els.loginErrorBox.classList.remove("hidden");
    } else {
      els.loginError.classList.remove("hidden");
    }
  }

  function goToCheckpointOrScanner() {
    const session = Auth.getSession();
    updateStatusBar(session);
    if (session.selectedCheckpoint) {
      openScannerView();
    } else {
      renderCheckpoints(session.checkpoints);
      showView("viewCheckpoint");
    }
  }

  /* ---------------- Checkpoint select ---------------- */

  function renderCheckpoints(checkpoints) {
    els.checkpointList.innerHTML = "";
    (checkpoints || []).forEach((cp) => {
      const btn = document.createElement("button");
      btn.className = "checkpoint-btn";
      const icon = cp.id === "ENT" ? "🚪" : (cp.id === "BAD" ? "🎫" : (cp.id.indexOf("CAF") !== -1 || cp.id.indexOf("LUNCH") !== -1 ? "🍱" : (cp.id === "COU" ? "🏛️" : "📍")));
      btn.innerHTML = `
        <div class="cp-left">
          <span class="cp-icon">${icon}</span>
          <div class="cp-info">
            <span class="cp-name">${cp.name}</span>
            <span class="cp-tag ${cp.duplicateAllowed ? 'cp-multi' : 'cp-single'}">${cp.duplicateAllowed ? 'Multi-scan' : 'Single entry'}</span>
          </div>
        </div>
        <span class="cp-arrow">›</span>
      `;
      btn.disabled = cp.active === false;
      if (!btn.disabled) {
        btn.addEventListener("click", () => {
          Auth.updateSelectedCheckpoint({ id: cp.id, name: cp.name });
          updateStatusBar(Auth.getSession());
          openScannerView();
        });
      }
      els.checkpointList.appendChild(btn);
    });
  }

  function wireCheckpointSwitch() {
    if (els.changeCpBtn) {
      els.changeCpBtn.addEventListener("click", async () => {
        await Scanner.stop();
        const session = Auth.getSession();
        renderCheckpoints(session ? session.checkpoints : []);
        showView("viewCheckpoint");
      });
    }
  }

  /* ---------------- Scanner ---------------- */

  async function openScannerView() {
    showView("viewScanner");
    try {
      await Scanner.start(onQrDecoded);
    } catch (err) {
      alert(
        "Couldn't access the camera. Please allow camera permission for this site and reload."
      );
    }
  }

  function onQrDecoded(participantId) {
    vibrate(40);
    handleScan(participantId);
  }

  function wireManualEntry() {
    els.manualEntryBtn.addEventListener("click", () => {
      els.manualIdInput.value = "";
      els.manualModal.classList.remove("hidden");
      els.manualIdInput.focus();
    });
    els.manualCancelBtn.addEventListener("click", () => {
      els.manualModal.classList.add("hidden");
    });
    els.manualSubmitBtn.addEventListener("click", () => {
      const id = els.manualIdInput.value.trim().toUpperCase();
      els.manualModal.classList.add("hidden");
      if (id) handleScan(id);
    });
  }

  /* ---------------- Scan handling ---------------- */

  async function handleScan(participantId) {
    const session = Auth.getSession();
    if (!session || !session.selectedCheckpoint) return;

    const payload = {
      participantId,
      checkpointId: session.selectedCheckpoint.id,
      clientScanId: makeUUID(),
      timestamp: new Date().toISOString(),
    };

    if (!navigator.onLine) {
      await queueAndShowPending(payload, session);
      return;
    }

    try {
      const res = await Api.scan(session.volunteerId, session.pin, payload);
      handleScanResponse(res, payload, session);
    } catch (err) {
      // Network/timeout failure — queue for offline sync rather than lose the scan.
      await queueAndShowPending(payload, session);
    }
  }

  async function queueAndShowPending(payload, session) {
    await OfflineQueue.add(payload);
    await refreshPendingBadge();
    showResult({
      overlayClass: "pending",
      icon: "⏳",
      title: "Saved — will sync",
      name: payload.participantId,
      id: "",
      checkpoint: session.selectedCheckpoint.name,
      timeLabel: "Queued",
      time: formatTime(new Date()),
    });
  }

  function handleScanResponse(res, payload, session) {
    const status = (res && res.status) || "ERROR";
    const checkpointName = session.selectedCheckpoint.name;
    const nowLabel = formatTime(new Date());

    switch (status) {
      case "SUCCESS": {
        const p = res.participant || {};
        showResult({
          overlayClass: "success",
          icon: "✓",
          title: "Check-in Successful",
          name: p.name || "",
          id: p.track ? `${payload.participantId} · ${p.track}` : payload.participantId,
          checkpoint: checkpointName,
          timeLabel: "Time",
          time: nowLabel,
        });
        break;
      }
      case "DUPLICATE_SCAN": {
        const p = res.participant || {};
        const prev = res.previousScan || {};
        showResult({
          overlayClass: "duplicate",
          icon: "!",
          title: "Already Scanned",
          name: p.name || payload.participantId,
          id: payload.participantId,
          checkpoint: checkpointName,
          timeLabel: prev.timestamp ? "Previous scan" : "Status",
          time: prev.timestamp ? formatTime(new Date(prev.timestamp)) : "Duplicate",
        });
        break;
      }
      case "INVALID_ID":
        showResult({
          overlayClass: "error",
          icon: "✕",
          title: "Not a Valid Participant",
          name: payload.participantId,
          id: "Check the QR code or ask at the help desk",
          checkpoint: checkpointName,
          timeLabel: "Time",
          time: nowLabel,
        });
        break;
      case "INVALID_CHECKPOINT":
        showResult({
          overlayClass: "error",
          icon: "✕",
          title: "Checkpoint Closed",
          name: checkpointName,
          id: "This checkpoint is inactive right now",
          checkpoint: checkpointName,
          timeLabel: "Time",
          time: nowLabel,
        });
        break;
      case "AUTH_FAILED":
        showResult({
          overlayClass: "error",
          icon: "✕",
          title: "Session Expired",
          name: "Please log in again",
          id: "",
          checkpoint: checkpointName,
          timeLabel: "Time",
          time: nowLabel,
        });
        setTimeout(() => forceLogout(), Config.RESULT_AUTO_DISMISS_MS + 400);
        break;
      case "TIMEOUT":
        // Server was momentarily locked. Queue it so the background
        // sync loop retries automatically — clientScanId keeps it safe.
        OfflineQueue.add(payload).then(refreshPendingBadge);
        showResult({
          overlayClass: "pending",
          icon: "⏳",
          title: "Server Busy",
          name: "Will retry automatically",
          id: payload.participantId,
          checkpoint: checkpointName,
          timeLabel: "Time",
          time: nowLabel,
        });
        break;
      default:
        showResult({
          overlayClass: "error",
          icon: "✕",
          title: "Something Went Wrong",
          name: (res && res.message) || "Please try scanning again",
          id: payload.participantId,
          checkpoint: checkpointName,
          timeLabel: "Time",
          time: nowLabel,
        });
    }
  }

  function showResult({ overlayClass, icon, title, name, id, checkpoint, timeLabel, time }) {
    els.resultOverlay.className = `result-overlay ${overlayClass}`;
    els.resultIcon.textContent = icon;
    els.resultTitle.textContent = title;
    els.resultName.textContent = name || "";
    els.resultId.textContent = id || "";
    els.resultCheckpoint.textContent = checkpoint || "";
    els.resultTimeLabel.textContent = timeLabel || "Time";
    els.resultTime.textContent = time || "";
    els.resultOverlay.classList.remove("hidden");

    clearTimeout(dismissTimer);
    if (Config.RESULT_AUTO_DISMISS_MS > 0) {
      dismissTimer = setTimeout(dismissResult, Config.RESULT_AUTO_DISMISS_MS);
    }
  }

  function dismissResult() {
    clearTimeout(dismissTimer);
    els.resultOverlay.classList.add("hidden");
    Scanner.resume();
  }

  function wireResultDismiss() {
    els.scanNextBtn.addEventListener("click", dismissResult);
  }

  /* ---------------- Status bar / logout ---------------- */

  function updateStatusBar(session) {
    els.volunteerName.textContent = session.volunteerName || session.volunteerId;
    els.checkpointName.textContent = session.selectedCheckpoint
      ? session.selectedCheckpoint.name
      : "No checkpoint";
  }

  function wireLogout() {
    els.logoutBtn.addEventListener("click", async () => {
      const pending = await OfflineQueue.count();
      if (pending > 0) {
        const proceed = confirm(
          `${pending} scan(s) haven't synced yet. Logging out won't lose them, ` +
            `but they won't sync until someone logs back in. Log out anyway?`
        );
        if (!proceed) return;
      }
      forceLogout();
    });
  }

  async function forceLogout() {
    await Scanner.stop();
    Auth.logout();
    els.loginForm.reset();
    showView("viewLogin");
  }

  /* ---------------- Connectivity + background sync ---------------- */

  function updateConnDot() {
    els.connDot.classList.toggle("offline", !navigator.onLine);
    els.connDot.title = navigator.onLine ? "Online" : "Offline";
  }

  async function refreshPendingBadge() {
    const n = await OfflineQueue.count();
    els.pendingBadge.textContent = String(n);
    els.pendingBadge.classList.toggle("hidden", n === 0);
  }

  async function attemptSync() {
    if (!navigator.onLine || !Auth.isLoggedIn()) return;
    try {
      await OfflineQueue.sync(refreshBadgeSilently);
    } catch (e) {
      /* will retry on next interval */
    }
    refreshPendingBadge();
  }

  function refreshBadgeSilently(n) {
    els.pendingBadge.textContent = String(n);
    els.pendingBadge.classList.toggle("hidden", n === 0);
  }

  function wireConnectivity() {
    window.addEventListener("online", () => {
      updateConnDot();
      attemptSync();
    });
    window.addEventListener("offline", updateConnDot);
    syncTimer = setInterval(attemptSync, Config.SYNC_INTERVAL_MS);
  }

  /* ---------------- Helpers ---------------- */

  function makeUUID() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    // Fallback for older Android WebViews without crypto.randomUUID.
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function formatTime(date) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function vibrate(ms) {
    if (navigator.vibrate) navigator.vibrate(ms);
  }

  /* ---------------- Init ---------------- */

  function init() {
    cacheEls();
    wireLogin();
    wireCheckpointSwitch();
    wireManualEntry();
    wireResultDismiss();
    wireLogout();
    wireConnectivity();
    updateConnDot();
    refreshPendingBadge();

    if (Auth.isLoggedIn()) {
      goToCheckpointOrScanner();
    } else {
      showView("viewLogin");
    }

    attemptSync();
  }

  return { init };
})();
