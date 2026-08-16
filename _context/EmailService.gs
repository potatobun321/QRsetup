/**
 * JAI Conclave 2026 - Email & QA Service
 * Phase 5: ID Card Mapping and Batch Dispatch
 */

function forceAuth() {
  MailApp.getRemainingDailyQuota();
}

function mapIDCardsAndRunQA() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const configSheet = ss.getSheetByName("00_Configuration");
  const masterSheet = ss.getSheetByName("01_Participants_Master");
  const opSheet = ss.getSheetByName("02_Operational_State");
  
  // 1. Get Folder ID (Looks in Col A for the variable name, Col B for the ID)
  const configData = configSheet.getRange("A2:B").getValues();
  let folderId = "";
  for (let i = 0; i < configData.length; i++) {
    if (configData[i][0] === "ID_Card_Folder_ID") folderId = String(configData[i][1]).trim();
  }
  
  if (!folderId) {
    logAutomation("QA & Mapping", 0, "Failed", "ID_Card_Folder_ID missing in Configuration.");
    return;
  }
  
  const folder = DriveApp.getFolderById(folderId);
  const files = folder.getFiles();
  
  // 2. Read Drive Files
  const driveCards = {}; 
  let duplicateFiles = [];
  
  while (files.hasNext()) {
    const file = files.next();
    const fileName = file.getName();
    // Extract ID (e.g., matches JAI-26-000001 from JAI-26-000001_IDCard.png)
    const match = fileName.match(/(JAI-\d{2}-\d{6})/i); 
    
    if (match) {
      const pId = match[1].toUpperCase();
      if (driveCards[pId]) {
        duplicateFiles.push(fileName);
      } else {
        driveCards[pId] = { id: file.getId(), url: file.getUrl(), name: fileName };
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      }
    }
  }
  
  // 3. Read Database
  const lastRow = masterSheet.getLastRow();
  if (lastRow < 2) return;
  
  const masterData = masterSheet.getRange(2, 1, lastRow - 1, 6).getValues();
  const opData = opSheet.getRange(2, 1, lastRow - 1, 7).getValues(); // Up to Col G (ID_Card_Drive_URL)
  
  let missingCards = [];
  let missingEmails = [];
  let mappedCount = 0;
  const urlUpdates = []; // For batch writing to Col G
  const dbParticipantIds = new Set();
  
  for (let i = 0; i < masterData.length; i++) {
    const pId = String(masterData[i][0]).trim();
    const email = String(masterData[i][2]).trim();
    let currentCardUrl = String(opData[i][6]).trim(); // Col G is index 6
    
    if (!pId) {
      urlUpdates.push([currentCardUrl]);
      continue;
    }
    
    dbParticipantIds.add(pId);
    if (!email) missingEmails.push(pId);
    
    // Map Card
    if (driveCards[pId]) {
      urlUpdates.push([driveCards[pId].url]);
      mappedCount++;
    } else {
      urlUpdates.push([currentCardUrl]); // Keep existing or blank
      missingCards.push(pId);
    }
  }
  
  // 4. Find Orphaned Cards (In Drive, but not in DB)
  let orphanedCards = Object.keys(driveCards).filter(id => !dbParticipantIds.has(id));
  
  // 5. Write Mapped URLs to DB (Column G)
  if (urlUpdates.length > 0) {
    opSheet.getRange(2, 7, urlUpdates.length, 1).setValues(urlUpdates);
  }
  
  // 6. Generate QA Report
  let report = `Mapped ${mappedCount} ID cards.\n\n--- QA REPORT ---\n`;
  report += `Missing Emails: ${missingEmails.length}\n`;
  report += `Missing ID Cards: ${missingCards.length}\n`;
  report += `Orphaned Cards (No DB Match): ${orphanedCards.length}\n`;
  report += `Duplicate Files in Drive: ${duplicateFiles.length}\n`;
  
  if (missingEmails.length > 0) report += `\nSample Missing Emails: ${missingEmails.slice(0, 5).join(", ")}`;
  if (missingCards.length > 0) report += `\nSample Missing Cards: ${missingCards.slice(0, 5).join(", ")}`;
  if (orphanedCards.length > 0) report += `\nSample Orphaned Cards: ${orphanedCards.slice(0, 5).join(", ")}`;
  
  logAutomation("QA & Mapping", mappedCount, (missingCards.length > 0 || missingEmails.length > 0) ? "Partial Success" : "Success", report);
  SpreadsheetApp.getUi().alert("QA & Mapping Complete", report, SpreadsheetApp.getUi().ButtonSet.OK);
}


function dispatchIDCardEmails() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    logAutomation("dispatchIDCardEmails", 0, "Failed", "Could not acquire script lock.");
    return;
  }
  
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const masterSheet = ss.getSheetByName("01_Participants_Master");
    const opSheet = ss.getSheetByName("02_Operational_State");
    
    const lastRow = opSheet.getLastRow();
    if (lastRow < 2) return;
    
    // Check Google's strict daily quota
    const remainingQuota = MailApp.getRemainingDailyQuota();
    if (remainingQuota < 5) {
      logAutomation("dispatchIDCardEmails", 0, "Failed", `Daily email quota exhausted. Remaining: ${remainingQuota}`);
      return;
    }
    
    // Process a safe batch size (e.g., 50) or whatever quota remains
    const BATCH_SIZE = Math.min(50, remainingQuota); 
    
    const masterData = masterSheet.getRange(2, 1, lastRow - 1, 6).getValues(); 
    const opData = opSheet.getRange(2, 1, lastRow - 1, 10).getValues(); 
    // Col A: ID, G: ID_Card_URL, H: Sent_At, I: Status, J: Retry_Count
    
    let emailsSent = 0;
    let errors = 0;
    const opUpdates = []; // Batch updates for Cols H, I, J
    
    for (let i = 0; i < opData.length; i++) {
      let pId = String(opData[i][0]).trim();
      let idCardUrl = String(opData[i][6]).trim(); // Col G
      let status = String(opData[i][8]).trim();    // Col I
      let retryCount = parseInt(opData[i][9]) || 0; // Col J
      
      let rowUpdate = [opData[i][7], opData[i][8], opData[i][9]]; // Default: no change
      
      if (emailsSent >= BATCH_SIZE) {
        opUpdates.push(rowUpdate);
        continue;
      }
      
      // Condition: Has ID, Has ID Card, Not Success, Retries < 3
      if (pId && idCardUrl && status !== "Success" && retryCount < 3) {
        let name = String(masterData[i][1]).trim();
        let email = String(masterData[i][2]).trim();
        let track = String(masterData[i][5]).trim();
        
        if (!email) {
          opUpdates.push(rowUpdate);
          continue;
        }
        
        try {
          // Extract File ID
          const fileIdMatch = idCardUrl.match(/[-\w]{25,}/);
          if (!fileIdMatch) throw new Error("Invalid ID Card Drive URL");
          
          const cardBlob = DriveApp.getFileById(fileIdMatch[0]).getBlob().setName(`${pId}_Pass.png`);
          
          // Build HTML
          const template = HtmlService.createTemplateFromFile('IDCardEmailTemplate');
          template.name = name;
          template.participantId = pId;
          template.track = track;
          const htmlBody = template.evaluate().getContent();
          
          // Dispatch
          MailApp.sendEmail({
            to: email,
            subject: "Your Official Entry Pass: JAI Conclave 2026",
            htmlBody: htmlBody,
            inlineImages: { idCardImage: cardBlob }
          });
          
          rowUpdate = [new Date(), "Success", retryCount];
          emailsSent++;
          
        } catch (e) {
          console.error(`Email failed for ${pId}: ${e.message}`);
          rowUpdate = [new Date(), "Failed", retryCount + 1];
          errors++;
        }
      }
      opUpdates.push(rowUpdate);
    }
    
    // Batch Write Statuses to Cols H, I, J
    if (opUpdates.length > 0) {
      opSheet.getRange(2, 8, opUpdates.length, 3).setValues(opUpdates);
    }
    
    if (emailsSent > 0 || errors > 0) {
      logAutomation("dispatchIDCardEmails", emailsSent + errors, (errors > 0) ? "Partial Success" : "Success", `Sent: ${emailsSent}, Quota Remaining: ${MailApp.getRemainingDailyQuota()}`);
    }
    
  } catch (error) {
    logAutomation("dispatchIDCardEmails", 0, "Failed", error.toString());
  } finally {
    lock.releaseLock();
  }
}
