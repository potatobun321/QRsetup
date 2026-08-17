/**
 * JAI Conclave 2026 - Scanner Handlers (BULLETPROOF & SCALE HARDENED)
 * File: 02_ScannerHandlers.gs
 */

// --- HIGH-SPEED COMPACT CACHING ENGINE (100KB-Safe) ---

function getParticipantsMap() {
  const cache = CacheService.getScriptCache();
  const cachedJson = cache.get("COMPACT_PARTICIPANTS_MAP");
  
  if (cachedJson) {
    try {
      const compactMap = JSON.parse(cachedJson);
      const map = {};
      for (const id in compactMap) {
        map[id] = { 
          name: compactMap[id][0], 
          type: compactMap[id][1],
          stay: compactMap[id][2],
          acc: compactMap[id][3],
          lunch: compactMap[id][4] === 1,
          dinner: compactMap[id][5] === 1
        };
      }
      return map;
    } catch (e) {}
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const masterSheet = ss.getSheetByName("01_Participants_Master");
  const lastRow = masterSheet ? masterSheet.getLastRow() : 0;
  const map = {};
  const compactMap = {}; // Compact tuple: [name, track]
  
  if (lastRow > 1) {
    const data = masterSheet.getRange(2, 1, lastRow - 1, 12).getValues();
    for (let i = 0; i < data.length; i++) {
      const id = String(data[i][0]).trim().toUpperCase();
      if (id) {
        const name = String(data[i][1]).trim();
        const type = String(data[i][7]).trim();
        const stay = String(data[i][8]).trim();
        const acc = String(data[i][9]).trim();
        const lunch = String(data[i][10]).trim().toUpperCase() === "TRUE" ? 1 : 0;
        const dinner = String(data[i][11]).trim().toUpperCase() === "TRUE" ? 1 : 0;
        
        map[id] = { name, type, stay, acc, lunch: lunch === 1, dinner: dinner === 1 };
        compactMap[id] = [name, type, stay, acc, lunch, dinner];
      }
    }
  }
  
  // Cache for 20 minutes (1200 seconds) - Compact payload fits well under 100KB
  try {
    cache.put("COMPACT_PARTICIPANTS_MAP", JSON.stringify(compactMap), 1200);
  } catch (e) {
    Logger.log("Cache payload warning: " + e.toString());
  }
  return map;
}

function getCheckpointsMap() {
  const cache = CacheService.getScriptCache();
  const cachedJson = cache.get("CHECKPOINTS_MAP");
  if (cachedJson) {
    try {
      return JSON.parse(cachedJson);
    } catch (e) {}
  }

  const checkpoints = getCheckpoints(); // From 03_AuthAndHelpers.gs
  const map = {};
  checkpoints.forEach(cp => { map[cp.id] = cp; });
  
  try { cache.put("CHECKPOINTS_MAP", JSON.stringify(map), 1200); } catch (e) {}
  return map;
}

// --- SCAN HANDLERS ---

function handleScan(body) {
  const auth = authenticate(body.volunteerId, body.pin);
  if (!auth.ok) return { success: false, status: "AUTH_FAILED", message: "Invalid Volunteer ID or PIN." };
  
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { success: false, status: "TIMEOUT", message: "Server busy, please retry." };
  
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const logSheet = ss.getSheetByName("03_Activity_Log");
    const logLastRow = logSheet ? logSheet.getLastRow() : 0;
    const logData = logLastRow > 1 ? logSheet.getRange(2, 1, logLastRow - 1, 7).getValues() : [];
    
    const volunteerIdentifier = body.deviceId ? `${body.volunteerId} [${body.deviceId}]` : body.volunteerId;
    const result = processSingleScanLogic(body.payload, volunteerIdentifier, logData);
    
    // SAFE: Only write if result.log is NOT null (prevents idempotency crash)
    if (result.log && logSheet) {
      logSheet.appendRow([
        new Date(), 
        result.log.participantId, 
        result.log.checkpointId, 
        result.log.volunteerId, 
        result.log.status, 
        result.log.message, 
        result.log.clientScanId
      ]);
    }
    
    return result.response;
  } finally {
    lock.releaseLock();
  }
}

function handleBulkSync(body) {
  const auth = authenticate(body.volunteerId, body.pin);
  if (!auth.ok) return { success: false, status: "AUTH_FAILED", message: "Invalid Volunteer ID or PIN." };
  
  const items = Array.isArray(body.payload) ? body.payload : [];
  if (items.length === 0) return { success: true, status: "SYNC_COMPLETE", results: [] };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { success: false, status: "TIMEOUT", message: "Server busy, please retry." };
  
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const logSheet = ss.getSheetByName("03_Activity_Log");
    const logLastRow = logSheet ? logSheet.getLastRow() : 0;
    const logData = logLastRow > 1 ? logSheet.getRange(2, 1, logLastRow - 1, 7).getValues() : [];
    
    const results = [];
    const rowsToAppend = [];
    const timestamp = new Date();
    const volunteerIdentifier = body.deviceId ? `${body.volunteerId} [${body.deviceId}]` : body.volunteerId;
    
    items.forEach(item => {
      const result = processSingleScanLogic(item, volunteerIdentifier, logData);
      results.push({ clientScanId: item.clientScanId, status: result.response.status });
      
      // SAFE: Only append if it's a new write (not an already-recorded replay)
      if (result.log) {
        rowsToAppend.push([
          timestamp, 
          result.log.participantId, 
          result.log.checkpointId, 
          result.log.volunteerId, 
          result.log.status, 
          result.log.message, 
          result.log.clientScanId
        ]);
        
        // Update in-memory logData so subsequent items in the SAME batch know about this scan
        logData.push([
          timestamp, 
          result.log.participantId, 
          result.log.checkpointId, 
          result.log.volunteerId, 
          result.log.status, 
          result.log.message, 
          result.log.clientScanId
        ]);
      }
    });
    
    // SINGLE BATCH WRITE: All offline scans committed in one atomic operation
    if (rowsToAppend.length > 0 && logSheet) {
      logSheet.getRange(logSheet.getLastRow() + 1, 1, rowsToAppend.length, 7).setValues(rowsToAppend);
    }
    
    return { success: true, status: "SYNC_COMPLETE", results: results };
  } finally {
    lock.releaseLock();
  }
}

// --- CORE LOGIC ---

function processSingleScanLogic(payload, volunteerId, logData) {
  const participantId = String(payload.participantId || "").trim().toUpperCase();
  const checkpointId = String(payload.checkpointId || "").trim().toUpperCase();
  const clientScanId = String(payload.clientScanId || "").trim();
  
  const logEntry = { participantId, checkpointId, volunteerId, clientScanId, status: "ERROR", message: "" };
  
  if (!participantId || !checkpointId || !clientScanId) {
    return { response: { success: false, status: "ERROR", message: "Missing required fields." }, log: logEntry };
  }

  // 1. Idempotency Check: If already processed, return original outcome without re-logging
  for (let i = 0; i < logData.length; i++) {
    if (String(logData[i][6]).trim() === clientScanId) {
      const pastStatus = String(logData[i][4]).trim().toLowerCase();
      const isSuccess = (pastStatus === "success");
      return { 
        response: { 
          success: isSuccess, 
          status: isSuccess ? "SUCCESS" : "DUPLICATE_SCAN", 
          message: "Scan recovered from queue." 
        },
        log: null // Null indicates: DO NOT write to sheet again
      };
    }
  }

  // 2. High-Speed Cached Participant Validation
  const participants = getParticipantsMap();
  const participant = participants[participantId];
  
  if (!participant) {
    logEntry.status = "Invalid ID"; 
    logEntry.message = "Not found in Master";
    return { response: { success: false, status: "INVALID_ID", message: "Participant ID not found." }, log: logEntry };
  }

  // 3. High-Speed Cached Checkpoint Validation
  const checkpoints = getCheckpointsMap();
  const cp = checkpoints[checkpointId];
  
  if (!cp || !cp.active) {
    logEntry.status = "Invalid Checkpoint"; 
    logEntry.message = "Closed or missing";
    return { response: { success: false, status: "INVALID_CHECKPOINT", message: "Checkpoint closed or invalid." }, log: logEntry };
  }

  // 4. Validate Entitlement Rules
  if (cp.entitlementRule) {
    if (cp.entitlementRule === "LUNCH" && !participant.lunch) {
      logEntry.status = "Denied"; logEntry.message = "Lunch Not Permitted";
      return { response: { success: false, status: "ENTITLEMENT_DENIED", message: "Lunch Not Permitted.", participant }, log: logEntry };
    }
    if (cp.entitlementRule === "DINNER" && !participant.dinner) {
      logEntry.status = "Denied"; logEntry.message = "Dinner Not Permitted";
      return { response: { success: false, status: "ENTITLEMENT_DENIED", message: "Dinner Not Permitted.", participant }, log: logEntry };
    }
    if (cp.entitlementRule === "RESIDENT" && participant.stay.toUpperCase() !== "RESIDENT") {
      logEntry.status = "Denied"; logEntry.message = "Not a Resident";
      return { response: { success: false, status: "ENTITLEMENT_DENIED", message: "Not a Resident.", participant }, log: logEntry };
    }
  }

  // 5. Duplicate Check (Strictly checks for previous SUCCESSFUL scans)
  if (!cp.duplicateAllowed) {
    for (let i = 0; i < logData.length; i++) {
      if (String(logData[i][1]).trim() === participantId && 
          String(logData[i][2]).trim() === checkpointId && 
          String(logData[i][4]).trim().toLowerCase() === "success") {
            
        logEntry.status = "Duplicate"; 
        logEntry.message = "Already scanned";
        return { 
          response: { success: false, status: "DUPLICATE_SCAN", message: `Already scanned at ${cp.name}`, participant },
          log: logEntry
        };
      }
    }
  }

  // 6. Successful Scan
  logEntry.status = "Success"; 
  logEntry.message = "Approved";
  return { 
    response: { success: true, status: "SUCCESS", message: `Checked into ${cp.name}`, participant },
    log: logEntry
  };
}
