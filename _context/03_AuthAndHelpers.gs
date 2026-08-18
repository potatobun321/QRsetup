/**
 * 03_AuthAndHelpers.gs
 * -------------------------------------------------------------
 * Authentication validator, checkpoint registry, and audit loggers.
 * Optimized with CacheService to prevent spreadsheet read lag during authentication.
 * -------------------------------------------------------------
 */

function authenticate(volId, pin, deviceId) {
  const vId = String(volId || "").trim().toUpperCase();
  const vPin = String(pin || "").trim();
  const devId = String(deviceId || "").trim();
  if (!vId || !vPin) return { ok: false, status: "AUTH_FAILED", message: "Missing ID or PIN." };

  const cache = CacheService.getScriptCache();
  const cachedAuth = cache.get("VOLUNTEERS_AUTH_MAP");
  let volunteers = null;

  if (cachedAuth) {
    try {
      volunteers = JSON.parse(cachedAuth);
    } catch (e) {}
  }

  if (!volunteers) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const configSheet = ss.getSheetByName("00_Configuration");
    if (!configSheet) return { ok: false, status: "CONFIG_ERROR", message: "Configuration sheet missing." };
    
    const lastRow = configSheet.getLastRow();
    if (lastRow < 2) return { ok: false, status: "AUTH_FAILED", message: "No volunteers configured." };
    
    // Read 8 columns starting at Col 10 (J to Q): ID, Name, PIN, Active, Assigned, Slot1, Slot2, AllowBackup
    const configData = configSheet.getRange(2, 10, lastRow - 1, 8).getValues();
    volunteers = {};
    
    for (let i = 0; i < configData.length; i++) {
      const rowId = String(configData[i][0]).trim().toUpperCase();
      if (rowId) {
        volunteers[rowId] = {
          rowIndex: i + 2,
          name: String(configData[i][1]).trim(),
          pin: String(configData[i][2]).trim(),
          active: String(configData[i][3]).trim().toUpperCase() === "TRUE",
          assignedCheckpoints: String(configData[i][4]).trim().toUpperCase(),
          slot1: String(configData[i][5]).trim(),
          slot2: String(configData[i][6]).trim(),
          allowBackup: String(configData[i][7]).trim().toUpperCase() === "TRUE"
        };
      }
    }

    try {
      cache.put("VOLUNTEERS_AUTH_MAP", JSON.stringify(volunteers), 1200); // 20 minutes
    } catch (e) {}
  }

  const vol = volunteers[vId];
  if (!vol || vol.pin !== vPin || !vol.active) {
    return { ok: false, status: "AUTH_FAILED", message: "Invalid ID, PIN, or account disabled." };
  }

  // Admin accounts or accounts assigned to 'ALL' are exempt from single-device locking
  const isAdmin = vId.startsWith("ADM") || vol.assignedCheckpoints === "ALL";
  if (isAdmin || !devId) {
    return { ok: true, name: vol.name, assignedCheckpoints: vol.assignedCheckpoints };
  }

  // 1. Device already bound to Slot 1 or Slot 2 -> Allow
  if (vol.slot1 === devId || vol.slot2 === devId) {
    return { ok: true, name: vol.name, assignedCheckpoints: vol.assignedCheckpoints };
  }

  // 2. Slot 1 is Empty -> Auto-bind this device to Slot 1
  if (!vol.slot1) {
    bindDeviceToSlot(vol.rowIndex, 15, devId); // Col O is 15 (Device_Slot_1)
    vol.slot1 = devId;
    try { cache.put("VOLUNTEERS_AUTH_MAP", JSON.stringify(volunteers), 1200); } catch (e) {}
    return { ok: true, name: vol.name, assignedCheckpoints: vol.assignedCheckpoints };
  }

  // 3. Slot 1 is occupied by a different phone -> Check Slot 2 (if enabled by Admin)
  if (vol.allowBackup) {
    if (!vol.slot2) {
      bindDeviceToSlot(vol.rowIndex, 16, devId); // Col P is 16 (Device_Slot_2)
      vol.slot2 = devId;
      try { cache.put("VOLUNTEERS_AUTH_MAP", JSON.stringify(volunteers), 1200); } catch (e) {}
      return { ok: true, name: vol.name, assignedCheckpoints: vol.assignedCheckpoints };
    }
  }

  // 4. Device is not authorized
  return { 
    ok: false, 
    status: "DEVICE_UNAUTHORIZED", 
    message: "This device is not authorized for " + vId + ". Please contact an Admin to authorize your backup phone." 
  };
}

function bindDeviceToSlot(row, col, deviceId) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const configSheet = ss.getSheetByName("00_Configuration");
    if (configSheet && row >= 2 && col >= 15) {
      configSheet.getRange(row, col).setValue(deviceId);
    }
  } catch (e) {
    Logger.log("Error binding device slot: " + e.toString());
  }
}

function flushAuthCache() {
  const cache = CacheService.getScriptCache();
  cache.remove("VOLUNTEERS_AUTH_MAP");
  return "Cache Flushed";
}

function getCheckpoints() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const configSheet = ss.getSheetByName("00_Configuration");
  if (!configSheet) return [];
  
  const lastRow = configSheet.getLastRow();
  if (lastRow < 2) return [];
  
  const configData = configSheet.getRange(2, 4, lastRow - 1, 5).getValues();
  const checkpoints = [];
  
  for (let i = 0; i < configData.length; i++) {
    const id = String(configData[i][0]).trim();
    if (id !== "") {
      checkpoints.push({
        id: id.toUpperCase(),
        name: String(configData[i][1]).trim(),
        duplicateAllowed: String(configData[i][2]).trim().toUpperCase() === "TRUE",
        active: String(configData[i][3]).trim().toUpperCase() === "TRUE",
        entitlementRule: String(configData[i][4]).trim().toUpperCase()
      });
    }
  }
  return checkpoints;
}

function logActivity(participantId, checkpointId, volunteerId, status, message, clientScanId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("03_Activity_Log");
  if (sheet) {
    sheet.appendRow([new Date(), participantId, checkpointId, volunteerId, status, message, clientScanId]);
  }
}

function logAutomation(automationName, recordsProcessed, status, errorDetails) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSheet = ss.getSheetByName("05_Automation_Log");
  if (logSheet) {
    logSheet.appendRow([new Date(), automationName, recordsProcessed, status, errorDetails || ""]);
  }
}
