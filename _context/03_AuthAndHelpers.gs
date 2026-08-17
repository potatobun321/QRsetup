/**
 * 03_AuthAndHelpers.gs
 * -------------------------------------------------------------
 * Authentication validator, checkpoint registry, and audit loggers.
 * Optimized with CacheService to prevent spreadsheet read lag during authentication.
 * -------------------------------------------------------------
 */

function authenticate(volId, pin) {
  const vId = String(volId || "").trim();
  const vPin = String(pin || "").trim();
  if (!vId || !vPin) return { ok: false };

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
    if (!configSheet) return { ok: false };
    
    const lastRow = configSheet.getLastRow();
    if (lastRow < 2) return { ok: false };
    
    const configData = configSheet.getRange(2, 10, lastRow - 1, 5).getValues();
    volunteers = {};
    
    for (let i = 0; i < configData.length; i++) {
      const rowId = String(configData[i][0]).trim();
      if (rowId) {
        volunteers[rowId] = {
          name: String(configData[i][1]).trim(),
          pin: String(configData[i][2]).trim(),
          active: String(configData[i][3]).trim().toUpperCase() === "TRUE",
          assignedCheckpoints: String(configData[i][4]).trim().toUpperCase()
        };
      }
    }

    try {
      cache.put("VOLUNTEERS_AUTH_MAP", JSON.stringify(volunteers), 1200); // 20 minutes
    } catch (e) {}
  }

  const vol = volunteers[vId];
  if (vol && vol.pin === vPin && vol.active) {
    return { ok: true, name: vol.name, assignedCheckpoints: vol.assignedCheckpoints };
  }
  return { ok: false };
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
