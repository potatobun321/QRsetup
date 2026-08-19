/**
 * ui.js
 * ---------------------------------------------------------------
 * Ties everything together: view navigation, form & button events,
 * camera lifecycle, audio synthesizer beeps, haptics, and instant
 * client-side QR validation. Entry point: UI.init().
 * ---------------------------------------------------------------
 */

/* ---------------- Web Audio API Synthesizer ---------------- */
const SoundFX = (() => {
  let ctx = null;

  function getContext() {
    if (!ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        ctx = new AudioCtx();
      }
    }
    if (ctx && ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  function playTone(freq, type, duration, startTime = 0) {
    const audioCtx = getContext();
    if (!audioCtx) return;

    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = type || "sine";
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime + startTime);

      gain.gain.setValueAtTime(0.2, audioCtx.currentTime + startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + startTime + duration);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start(audioCtx.currentTime + startTime);
      osc.stop(audioCtx.currentTime + startTime + duration);
    } catch (e) {
      /* Audio policy or device limitation */
    }
  }

  function playSuccess() {
    // Upbeat high chime (587Hz -> 880Hz)
    playTone(587.33, "sine", 0.09, 0);
    playTone(880, "sine", 0.14, 0.08);
  }

  function playDuplicate() {
    // Amber warning double-pulse (440Hz -> 349Hz)
    playTone(440, "triangle", 0.12, 0);
    playTone(349.23, "triangle", 0.18, 0.11);
  }

  function playError() {
    // Low warning buzzer (180Hz sawtooth)
    playTone(180, "sawtooth", 0.25, 0);
  }

  function playPending() {
    // Soft tick
    playTone(660, "sine", 0.08, 0);
  }

  return {
    init: getContext,
    playSuccess,
    playDuplicate,
    playError,
    playPending,
  };
})();

/* ---------------- Differentiated Haptics ---------------- */
const Haptics = {
  success() {
    if (navigator.vibrate) navigator.vibrate(40);
  },
  duplicate() {
    if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
  },
  error() {
    if (navigator.vibrate) navigator.vibrate([140, 50, 140, 50, 200]);
  },
  pending() {
    if (navigator.vibrate) navigator.vibrate(60);
  },
};

/* ---------------- Main UI Module ---------------- */
const UI = (() => {
  let els = {};
  let syncTimer = null;
  let dismissTimer = null;

  // Regex format for Participant IDs: JAI-26-000001
  const JAI_QR_REGEX = /^JAI-\d{2}-\d{6}$/i;

  function cacheEls() {
    els = {
      statusBar: document.getElementById("statusBar"),
      volunteerName: document.getElementById("volunteerName"),
      checkpointName: document.getElementById("checkpointName"),
      scanCounter: document.getElementById("scanCounter"),
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
      torchToggleBtn: document.getElementById("torchToggleBtn"),
      torchLabel: document.getElementById("torchLabel"),
      manualEntryBtn: document.getElementById("manualEntryBtn"),
      
      viewDashboard: document.getElementById("view-dashboard"),
      adminDashboardBtn: document.getElementById("adminDashboardBtn"),
      closeDashboardBtn: document.getElementById("closeDashboardBtn"),
      tabDashStatsBtn: document.getElementById("tabDashStatsBtn"),
      tabDashDevicesBtn: document.getElementById("tabDashDevicesBtn"),
      dashStatsPanel: document.getElementById("dashStatsPanel"),
      dashDevicePanel: document.getElementById("dashDevicePanel"),
      dashTotalExpected: document.getElementById("dashTotalExpected"),
      dashMetricsGrid: document.getElementById("dashMetricsGrid"),
      dashLastUpdate: document.getElementById("dashLastUpdate"),
      deviceSearchInput: document.getElementById("deviceSearchInput"),
      volunteerDeviceList: document.getElementById("volunteerDeviceList"),

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
    ["viewLogin", "viewCheckpoint", "viewScanner", "viewDashboard"].forEach((k) => {
      if (els[k]) els[k].classList.add("hidden");
    });
    if (els[name]) els[name].classList.remove("hidden");
    if (els.statusBar) els.statusBar.classList.toggle("hidden", name === "viewLogin");
  }

  /* ---------------- Login ---------------- */

  function wireLogin() {
    els.loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      SoundFX.init(); // Unlock AudioContext on user action

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
        if ("serviceWorker" in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (let reg of registrations) {
            await reg.unregister();
          }
        }
        if ("caches" in window) {
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

  /* ---------------- Checkpoint Select ---------------- */

  function renderCheckpoints(checkpoints) {
    const session = Auth.getSession();
    const isAdmin = (session && session.isAdmin) || (session && session.volunteerId && session.volunteerId.toUpperCase().startsWith("ADM"));
    const rawAssigned = (session && session.assignedCheckpoints) ? session.assignedCheckpoints.toUpperCase().trim() : "";
    const assigned = (isAdmin || rawAssigned === "ALL" || rawAssigned === "") ? "ALL" : rawAssigned;
    
    els.checkpointList.innerHTML = "";
    (checkpoints || []).forEach((cp) => {
      if (assigned !== "ALL") {
        const allowedList = assigned.split(",").map(x => x.trim());
        if (!allowedList.includes(cp.id)) return;
      }
      
      const btn = document.createElement("button");
      btn.className = "checkpoint-btn";
      const icon =
        cp.id === "ENT"
          ? "🚪"
          : cp.id === "BAD"
          ? "🎫"
          : cp.id.indexOf("CAF") !== -1 || cp.id.indexOf("LUNCH") !== -1
          ? "🍱"
          : cp.id === "COU"
          ? "🏛️"
          : "📍";
      btn.innerHTML = `
        <div class="cp-left">
          <span class="cp-icon">${icon}</span>
          <div class="cp-info">
            <span class="cp-name">${cp.name}</span>
            <span class="cp-tag ${cp.duplicateAllowed ? "cp-multi" : "cp-single"}">${
        cp.duplicateAllowed ? "Multi-scan" : "Single entry"
      }</span>
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

    if (els.adminDashboardBtn) {
      // ONLY true Admins (ADM-XX) get the admin dashboard button!
      els.adminDashboardBtn.classList.toggle("hidden", !isAdmin);
    }
  }

  function wireCheckpointSwitch() {
    if (els.changeCpBtn) {
      els.changeCpBtn.addEventListener("click", async () => {
        await Scanner.stop();
        if (els.torchToggleBtn) {
          els.torchToggleBtn.classList.remove("active");
          els.torchToggleBtn.classList.add("hidden");
        }
        const session = Auth.getSession();
        renderCheckpoints(session ? session.checkpoints : []);
        showView("viewCheckpoint");
      });
    }
  }

  /* ---------------- Dashboard ---------------- */
  let dashPollTimer = null;
  let cachedVolunteersList = [];

  function wireDashboard() {
    if (!els.adminDashboardBtn) return;
    
    els.adminDashboardBtn.addEventListener("click", () => {
      showView("viewDashboard");
      switchDashTab("stats");
      refreshDashboard();
      dashPollTimer = setInterval(refreshDashboard, 30000);
    });

    els.closeDashboardBtn.addEventListener("click", () => {
      clearInterval(dashPollTimer);
      showView("viewCheckpoint");
    });

    if (els.tabDashStatsBtn && els.tabDashDevicesBtn) {
      els.tabDashStatsBtn.addEventListener("click", () => switchDashTab("stats"));
      els.tabDashDevicesBtn.addEventListener("click", () => {
        switchDashTab("devices");
        refreshVolunteerDevices();
      });
    }

    if (els.deviceSearchInput) {
      els.deviceSearchInput.addEventListener("input", (e) => {
        const query = e.target.value.trim().toLowerCase();
        renderVolunteerDevices(query);
      });
    }
  }

  function switchDashTab(tabName) {
    if (tabName === "stats") {
      if (els.dashStatsPanel) els.dashStatsPanel.classList.remove("hidden");
      if (els.dashDevicePanel) els.dashDevicePanel.classList.add("hidden");
      if (els.tabDashStatsBtn) {
        els.tabDashStatsBtn.className = "btn-primary";
      }
      if (els.tabDashDevicesBtn) {
        els.tabDashDevicesBtn.className = "btn-secondary";
      }
    } else {
      if (els.dashStatsPanel) els.dashStatsPanel.classList.add("hidden");
      if (els.dashDevicePanel) els.dashDevicePanel.classList.remove("hidden");
      if (els.tabDashStatsBtn) {
        els.tabDashStatsBtn.className = "btn-secondary";
      }
      if (els.tabDashDevicesBtn) {
        els.tabDashDevicesBtn.className = "btn-primary";
      }
    }
  }

  async function refreshDashboard() {
    if (!navigator.onLine) return;
    try {
      const res = await Api.getDashboardStats();
      if (res && res.success && res.data) {
        const { totalExpected, checkpoints, timestamp } = res.data;
        
        els.dashTotalExpected.textContent = totalExpected || 0;
        els.dashLastUpdate.textContent = formatTime(new Date(timestamp));
        
        els.dashMetricsGrid.innerHTML = "";
        checkpoints.forEach(cp => {
          const card = document.createElement("div");
          card.className = "card";
          card.style.marginBottom = "0.5rem";
          card.style.background = "var(--surface)";
          card.style.border = "1px solid var(--border)";
          card.style.borderRadius = "var(--radius-sm)";
          card.style.padding = "12px 16px";
          card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div style="font-weight: 600; font-size: 14px;">${cp.name}</div>
              <div style="font-size: 1.25rem; font-weight: 800; color: var(--accent);">${cp.count}</div>
            </div>
          `;
          els.dashMetricsGrid.appendChild(card);
        });
      }
    } catch (e) {
      console.warn("Dashboard sync failed", e);
    }
  }

  async function refreshVolunteerDevices() {
    if (!navigator.onLine) return;
    if (els.volunteerDeviceList) {
      els.volunteerDeviceList.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-dim);">Loading volunteer devices...</div>`;
    }
    try {
      const res = await Api.getVolunteerDevices();
      if (res && res.success && res.volunteers) {
        cachedVolunteersList = res.volunteers;
        const query = els.deviceSearchInput ? els.deviceSearchInput.value.trim().toLowerCase() : "";
        renderVolunteerDevices(query);
      }
    } catch (e) {
      if (els.volunteerDeviceList) {
        els.volunteerDeviceList.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--red);">Failed to load devices. Please try again.</div>`;
      }
    }
  }

  function renderVolunteerDevices(query = "") {
    if (!els.volunteerDeviceList) return;
    els.volunteerDeviceList.innerHTML = "";

    const filtered = cachedVolunteersList.filter(v => {
      return v.id.toLowerCase().includes(query) || v.name.toLowerCase().includes(query);
    });

    if (filtered.length === 0) {
      els.volunteerDeviceList.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-dim);">No matching volunteers found.</div>`;
      return;
    }

    filtered.forEach(vol => {
      const card = document.createElement("div");
      card.className = "card";
      card.style.background = "var(--surface)";
      card.style.border = "1px solid var(--border)";
      card.style.borderRadius = "var(--radius-sm)";
      card.style.padding = "12px 14px";
      card.style.display = "flex";
      card.style.flexDirection = "column";
      card.style.gap = "8px";

      const slot1Color = vol.slot1 === "Bound" ? "var(--accent)" : "var(--text-dim)";
      const slot2Color = vol.slot2 === "Bound" ? "var(--accent)" : (vol.allowBackup ? "var(--amber)" : "var(--text-dim)");
      const backupStatusText = vol.allowBackup ? "Backup Slot: Unlocked" : "Backup Slot: Locked";

      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <span style="font-weight: 700; font-size: 13.5px; color: var(--text);">${vol.id}</span>
            <span style="font-size: 12px; color: var(--text-dim); margin-left: 6px;">${vol.name}</span>
          </div>
          <span style="font-size: 10.5px; font-weight: 700; padding: 2px 6px; border-radius: 4px; background: ${vol.active ? 'rgba(67, 199, 142, 0.15)' : 'rgba(224, 90, 78, 0.15)'}; color: ${vol.active ? 'var(--accent)' : 'var(--red)'};">
            ${vol.active ? 'ACTIVE' : 'DISABLED'}
          </span>
        </div>

        <div style="display: flex; gap: 12px; font-size: 11.5px; color: var(--text-dim);">
          <div>Primary: <strong style="color: ${slot1Color}">${vol.slot1}</strong></div>
          <div>Backup: <strong style="color: ${slot2Color}">${vol.slot2}</strong> (${backupStatusText})</div>
        </div>

        <div style="display: flex; gap: 8px; margin-top: 4px;">
          <button class="chip-btn btn-unlock-backup" data-id="${vol.id}" style="flex: 1; padding: 6px; font-size: 11px; background: rgba(226, 184, 87, 0.12); border-color: rgba(226, 184, 87, 0.3); color: var(--amber);">
            ${vol.allowBackup ? '✓ Backup Active' : '🔓 Allow Backup'}
          </button>
          <button class="chip-btn btn-reset-slots" data-id="${vol.id}" style="padding: 6px 10px; font-size: 11px; background: rgba(224, 90, 78, 0.12); border-color: rgba(224, 90, 78, 0.3); color: var(--red);">
            🔄 Reset Device
          </button>
        </div>
      `;

      const unlockBtn = card.querySelector(".btn-unlock-backup");
      const resetBtn = card.querySelector(".btn-reset-slots");

      unlockBtn.addEventListener("click", async () => {
        unlockBtn.disabled = true;
        unlockBtn.textContent = "Unlocking...";
        try {
          const res = await Api.unlockVolunteerDevice(vol.id, "allowBackup");
          if (res && res.success) {
            vol.allowBackup = true;
            renderVolunteerDevices(query);
          } else {
            alert((res && res.message) || "Failed to authorize backup phone.");
            renderVolunteerDevices(query);
          }
        } catch (e) {
          alert("Network error updating device authorization.");
          renderVolunteerDevices(query);
        }
      });

      resetBtn.addEventListener("click", async () => {
        if (!confirm(`Reset all bound devices for ${vol.id} (${vol.name})? The next phone that signs in will become the new primary device.`)) return;
        resetBtn.disabled = true;
        resetBtn.textContent = "Resetting...";
        try {
          const res = await Api.unlockVolunteerDevice(vol.id, "resetSlots");
          if (res && res.success) {
            vol.slot1 = "Empty";
            vol.slot2 = "Empty";
            vol.allowBackup = false;
            renderVolunteerDevices(query);
          } else {
            alert((res && res.message) || "Failed to reset devices.");
            renderVolunteerDevices(query);
          }
        } catch (e) {
          alert("Network error resetting devices.");
          renderVolunteerDevices(query);
        }
      });

      els.volunteerDeviceList.appendChild(card);
    });
  }

  /* ---------------- Scanner View & Torch ---------------- */

  async function openScannerView() {
    showView("viewScanner");
    await new Promise((resolve) => setTimeout(resolve, 80));
    try {
      await Scanner.start(onQrDecoded);
      setTimeout(checkTorchAvailability, 500);
    } catch (err) {
      console.error("Camera start error:", err);
      alert("Couldn't access the camera. Please allow camera permission for this site and reload.");
    }
  }

  function checkTorchAvailability() {
    if (!els.torchToggleBtn) return;
    const canTorch = Scanner.hasTorch();
    els.torchToggleBtn.classList.toggle("hidden", !canTorch);
    els.torchToggleBtn.classList.toggle("active", Scanner.getTorchState());
  }

  function wireTorch() {
    if (els.torchToggleBtn) {
      els.torchToggleBtn.addEventListener("click", async () => {
        const isNowOn = await Scanner.toggleTorch();
        els.torchToggleBtn.classList.toggle("active", isNowOn);
        if (els.torchLabel) {
          els.torchLabel.textContent = isNowOn ? "Torch On" : "Torch";
        }
      });
    }
  }

  function onQrDecoded(participantId) {
    handleScan(participantId);
  }

  let sessionScanCount = 0;

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
      let id = els.manualIdInput.value.trim().toUpperCase();
      els.manualModal.classList.add("hidden");
      if (!id) return;

      // Smart shorthand: user types "42" -> expands to "JAI-26-000042"
      if (/^\d{1,6}$/.test(id)) {
        id = "JAI-26-" + id.padStart(6, "0");
      }
      handleScan(id);
    });
  }

  /* ---------------- Scan Processing & Validation ---------------- */

  async function handleScan(rawParticipantId) {
    const session = Auth.getSession();
    if (!session || !session.selectedCheckpoint) return;

    const rawStr = String(rawParticipantId || "").trim();
    const match = rawStr.match(JAI_QR_REGEX);
    const checkpointName = session.selectedCheckpoint.name;

    // 1. FAST CLIENT-SIDE REGEX PRE-VALIDATION (0ms Server Load)
    if (!match) {
      SoundFX.playError();
      Haptics.error();
      showResult({
        overlayClass: "error",
        icon: "✕",
        title: "Invalid QR Code",
        name: rawStr || "Unknown Code",
        id: "Expected format: JAI-26-XXXXXX",
        checkpoint: checkpointName,
        timeLabel: "Status",
        time: "Format Mismatch",
      });
      return;
    }

    const participantId = match[0].toUpperCase();

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
      // Network drop / timeout -> queue offline rather than losing the scan
      await queueAndShowPending(payload, session);
    }
  }

  async function queueAndShowPending(payload, session) {
    await OfflineQueue.add(payload);
    await refreshPendingBadge();
    SoundFX.playPending();
    Haptics.pending();

    showResult({
      overlayClass: "pending",
      icon: "⏳",
      title: "Saved — will sync",
      name: payload.participantId,
      id: "Stored locally in offline queue",
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
        sessionScanCount++;
        if (els.scanCounter) {
          els.scanCounter.textContent = `✓ ${sessionScanCount}`;
        }
        SoundFX.playSuccess();
        Haptics.success();
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
          type: p.type || "Participant",
          acc: p.acc || ""
        });
        break;
      }
      case "DUPLICATE_SCAN": {
        SoundFX.playDuplicate();
        Haptics.duplicate();
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
          time: prev.timestamp ? formatTime(new Date(prev.timestamp)) : "Duplicate Entry",
          type: p.type || "",
          acc: p.acc || ""
        });
        break;
      }
      case "INVALID_ID":
        SoundFX.playError();
        Haptics.error();
        showResult({
          overlayClass: "error",
          icon: "✕",
          title: "Not a Valid Participant",
          name: payload.participantId,
          id: "ID not found in master database",
          checkpoint: checkpointName,
          timeLabel: "Time",
          time: nowLabel,
        });
        break;
      case "INVALID_CHECKPOINT":
        SoundFX.playError();
        Haptics.error();
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
        SoundFX.playError();
        Haptics.error();
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
        SoundFX.playPending();
        Haptics.pending();
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
        SoundFX.playError();
        Haptics.error();
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

  function showResult({ overlayClass, icon, title, name, id, checkpoint, timeLabel, time, type, acc }) {
    els.resultOverlay.className = `result-overlay ${overlayClass}`;
    els.resultIcon.textContent = icon;
    els.resultTitle.textContent = title;
    els.resultName.textContent = name || "";
    els.resultId.textContent = id || "";
    els.resultCheckpoint.textContent = checkpoint || "";
    els.resultTimeLabel.textContent = timeLabel || "Time";
    els.resultTime.textContent = time || "";
    
    const typeGroup = document.getElementById("metaTypeGroup");
    const accGroup = document.getElementById("metaAccGroup");
    const resultType = document.getElementById("resultType");
    const resultAcc = document.getElementById("resultAcc");
    
    if (typeGroup && resultType) {
      if (type) {
        resultType.textContent = type;
        typeGroup.classList.remove("hidden");
      } else {
        typeGroup.classList.add("hidden");
      }
    }
    
    if (accGroup && resultAcc) {
      if (acc) {
        resultAcc.textContent = acc;
        accGroup.classList.remove("hidden");
      } else {
        accGroup.classList.add("hidden");
      }
    }

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
    els.resultOverlay.addEventListener("click", dismissResult);
  }

  /* ---------------- Status Bar & Logout ---------------- */

  function updateStatusBar(session) {
    if (!session) return;
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
    if (els.torchToggleBtn) {
      els.torchToggleBtn.classList.remove("active");
      els.torchToggleBtn.classList.add("hidden");
    }
    Auth.logout();
    els.loginForm.reset();
    showView("viewLogin");
  }

  /* ---------------- Connectivity & Background Sync ---------------- */

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
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function formatTime(date) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  /* ---------------- Init ---------------- */

  function init() {
    cacheEls();
    wireLogin();
    wireCheckpointSwitch();
    wireDashboard();
    wireTorch();
    wireManualEntry();
    wireResultDismiss();
    wireLogout();
    wireConnectivity();
    updateConnDot();
    refreshPendingBadge();

    // User gesture listener to unlock AudioContext
    document.addEventListener("click", () => SoundFX.init(), { once: true });
    document.addEventListener("touchstart", () => SoundFX.init(), { once: true });

    if (Auth.isLoggedIn()) {
      goToCheckpointOrScanner();
    } else {
      showView("viewLogin");
    }

    attemptSync();
  }

  return { init };
})();
