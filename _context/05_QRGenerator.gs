/**
 * 05_QRGenerator.gs
 * -------------------------------------------------------------
 * Automated Participant ID & QR Code generator for JAI Conclave 2026.
 * -------------------------------------------------------------
 */

/**
 * Automatically assigns sequential IDs (e.g. JAI-26-000001)
 * to any row in 01_Participants_Master missing an ID.
 */
function generateParticipantIDs() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    logAutomation("generateParticipantIDs", 0, "Failed", "Could not acquire script lock.");
    return;
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const configSheet = ss.getSheetByName("00_Configuration");
    const masterSheet = ss.getSheetByName("01_Participants_Master");
    
    const lastRow = masterSheet.getLastRow();
    if (lastRow < 2) {
      logAutomation("generateParticipantIDs", 0, "Success", "No participants in database.");
      return;
    }
    
    const configData = configSheet.getRange("A2:B10").getValues();
    let prefix = "JAI";
    let year = "26";
    
    for (let i = 0; i < configData.length; i++) {
      if (configData[i][0] === "Event_Prefix") prefix = String(configData[i][1]).trim() || "JAI";
      if (configData[i][0] === "Event_Year") year = String(configData[i][1]).trim() || "26";
    }
    
    const idRange = masterSheet.getRange(2, 1, lastRow - 1, 1);
    const idValues = idRange.getValues();
    let assignedCount = 0;
    
    for (let i = 0; i < idValues.length; i++) {
      let currentId = String(idValues[i][0]).trim();
      if (currentId === "") {
        const sequenceNum = String(i + 1).padStart(6, '0');
        idValues[i][0] = `${prefix}-${year}-${sequenceNum}`;
        assignedCount++;
      }
    }
    
    if (assignedCount > 0) {
      idRange.setValues(idValues);
      logAutomation("generateParticipantIDs", assignedCount, "Success", `Assigned ${assignedCount} sequential IDs.`);
    } else {
      logAutomation("generateParticipantIDs", 0, "Success", "All participants already have IDs.");
    }
  } catch (error) {
    logAutomation("generateParticipantIDs", 0, "Failed", error.toString());
  } finally {
    lock.releaseLock();
  }
}

function generateQRs() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    logAutomation("generateQRs", 0, "Failed", "Could not acquire script lock.");
    return;
  }
  
  try {
    const startTime = Date.now();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const opSheet = ss.getSheetByName("02_Operational_State");
    const lastRow = opSheet.getLastRow();
    if (lastRow < 2) {
      logAutomation("generateQRs", 0, "Success", "No participants in database.");
      return;
    }
    
    const opData = opSheet.getRange(2, 1, lastRow - 1, 6).getValues();
    let needsQr = false;
    for (let i = 0; i < opData.length; i++) {
      if (String(opData[i][0]).trim() !== "" && String(opData[i][5]).trim() === "") {
        needsQr = true;
        break;
      }
    }
    
    if (!needsQr) {
      logAutomation("generateQRs", 0, "Success", "No participants requiring QR generation.");
      return;
    }

    const configSheet = ss.getSheetByName("00_Configuration");
    const configData = configSheet.getRange("A2:B").getValues();
    let folderId = "";
    
    for (let i = 0; i < configData.length; i++) {
      if (configData[i][0] === "QR_Folder_ID") {
        folderId = String(configData[i][1]).trim();
        break;
      }
    }
    
    if (!folderId || folderId === "[INSERT_ID]") {
      logAutomation("generateQRs", 0, "Failed", "QR_Folder_ID is missing or invalid in 00_Configuration.");
      return;
    }
    
    let qrFolder;
    try {
      qrFolder = DriveApp.getFolderById(folderId);
    } catch (e) {
      logAutomation("generateQRs", 0, "Failed", "Could not access Drive Folder. Check QR_Folder_ID.");
      return;
    }
    
    const existingFiles = {};
    const files = qrFolder.getFiles();
    while (files.hasNext()) {
      const file = files.next();
      existingFiles[file.getName()] = file.getUrl();
    }
    
    let processedCount = 0;
    let generatedCount = 0;
    let reusedCount = 0;
    let errorCount = 0;
    const urlUpdates = [];
    
    for (let i = 0; i < opData.length; i++) {
      let participantId = String(opData[i][0]).trim();
      let existingQrUrl = String(opData[i][5]).trim();
      
      if (!participantId || existingQrUrl) {
        urlUpdates.push([existingQrUrl]);
        continue;
      }
      
      processedCount++;
      const expectedFileName = `${participantId}.png`;
      
      if (existingFiles[expectedFileName]) {
        urlUpdates.push([existingFiles[expectedFileName]]);
        reusedCount++;
        continue;
      }
      
      const apiUrl = `https://quickchart.io/qr?text=${encodeURIComponent(participantId)}&size=500&margin=2`;
      
      try {
        const response = UrlFetchApp.fetch(apiUrl, { muteHttpExceptions: true });
        if (response.getResponseCode() === 200) {
          const imageBlob = response.getBlob().setName(expectedFileName);
          const file = qrFolder.createFile(imageBlob);
          file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
          
          urlUpdates.push([file.getUrl()]);
          generatedCount++;
        } else {
          urlUpdates.push([""]);
          errorCount++;
        }
      } catch (e) {
        urlUpdates.push([""]);
        errorCount++;
      }
    }
    
    if (generatedCount > 0 || reusedCount > 0) {
      opSheet.getRange(2, 6, urlUpdates.length, 1).setValues(urlUpdates);
    }
    
    const execTimeSecs = ((Date.now() - startTime) / 1000).toFixed(1);
    const details = `Processed: ${processedCount} | Generated: ${generatedCount} | Reused: ${reusedCount} | Failed: ${errorCount} | Time: ${execTimeSecs}s`;
    logAutomation("generateQRs", processedCount, errorCount > 0 ? "Partial Success" : "Success", details);
    
  } catch (error) {
    logAutomation("generateQRs", 0, "Failed", error.toString());
  } finally {
    lock.releaseLock();
  }
}

