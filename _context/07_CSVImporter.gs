/**
 * 07_CSVImporter.gs
 * -------------------------------------------------------------
 * Automated CSV Ingestion Pipeline for JAI Conclave 2026 EMD.
 * Monitors Google Drive import folder, dynamically maps registration
 * CSV columns to 01_Participants_Master, safely appends rows,
 * and archives the processed files to prevent duplicate imports.
 * -------------------------------------------------------------
 */

function importCSVData() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    logAutomation("CSV Import", 0, "Failed", "Could not acquire script lock.");
    return;
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const configSheet = ss.getSheetByName("00_Configuration");
    const masterSheet = ss.getSheetByName("01_Participants_Master");

    if (!configSheet || !masterSheet) {
      logAutomation("CSV Import", 0, "Failed", "Missing required sheets (00_Configuration or 01_Participants_Master).");
      return;
    }

    // 1. Read Folder IDs from 00_Configuration
    const configData = configSheet.getRange("A2:B").getValues();
    let importFolderId = "";
    let archiveFolderId = "";

    const extractFolderId = (input) => {
      const str = String(input || "").trim();
      const match = str.match(/folders\/([-\w]{25,})/i) || str.match(/[-\w]{25,}/);
      return match ? match[1] || match[0] : str;
    };

    for (let i = 0; i < configData.length; i++) {
      const key = String(configData[i][0]).trim();
      const val = String(configData[i][1]).trim();
      if (key === "CSV_Import_Folder_ID") importFolderId = extractFolderId(val);
      if (key === "CSV_Archive_Folder_ID") archiveFolderId = extractFolderId(val);
    }

    if (!importFolderId || importFolderId === "[INSERT_ID]") {
      logAutomation("CSV Import", 0, "Failed", "CSV_Import_Folder_ID is missing or not configured in 00_Configuration.");
      return;
    }

    let importFolder;
    try {
      importFolder = DriveApp.getFolderById(importFolderId);
    } catch (e) {
      logAutomation("CSV Import", 0, "Failed", "Cannot access CSV Import Folder. Check permissions and ID.");
      return;
    }

    let archiveFolder = null;
    if (archiveFolderId && archiveFolderId !== "[INSERT_ID]") {
      try {
        archiveFolder = DriveApp.getFolderById(archiveFolderId);
      } catch (e) {
        Logger.log("Archive folder not accessible, will fallback to file renaming.");
      }
    }

    // 2. Fetch CSV files from the import folder
    const files = importFolder.getFilesByType(MimeType.CSV);
    const allFiles = [];
    while (files.hasNext()) {
      allFiles.push(files.next());
    }

    if (allFiles.length === 0) {
      // Check for .csv extension even if MIME type is plain text
      const genericFiles = importFolder.getFiles();
      while (genericFiles.hasNext()) {
        const f = genericFiles.next();
        if (f.getName().toLowerCase().endsWith(".csv")) {
          allFiles.push(f);
        }
      }
    }

    if (allFiles.length === 0) {
      Logger.log("No CSV files found in import folder.");
      return;
    }

    // 3. Read target schema from Row 1 of 01_Participants_Master
    // Expected: ["Participant_ID", "Full_Name", "Email_Address", "Phone_Number", "Institution", "Track", "Sub_Track", "Participant_Type"]
    const masterHeaders = masterSheet.getRange(1, 1, 1, masterSheet.getLastColumn() || 8).getValues()[0].map(h => String(h).trim());
    const totalCols = masterHeaders.length;

    // Normalizer helper: strips underscores, spaces, dashes and lowercases
    const normalize = (str) => String(str || "").toLowerCase().replace(/[^a-z0-9]/g, "");

    // Known alias dictionary for flexible mapping from registration forms (Google Forms, Townscript, Unstop, etc.)
    const aliases = {
      fullname: ["name", "fullname", "participantname", "studentname", "delegatename", "attendee"],
      emailaddress: ["email", "emailaddress", "e-mail", "mail", "primaryemail"],
      phonenumber: ["phone", "phonenumber", "mobile", "mobilenumber", "contact", "contactnumber", "whatsapp"],
      institution: ["institution", "college", "collegename", "university", "school", "organization", "company"],
      track: ["track", "eventtrack", "domain", "committee", "stream"],
      subtrack: ["subtrack", "sub_track", "subdomain", "category", "specialization", "portfolio"],
      participanttype: ["participanttype", "participant_type", "type", "role", "designation", "tickettype"],
      staystatus: ["staystatus", "stay_status", "resident", "residence", "stay", "accommodation"],
      accommodationdetails: ["accommodationdetails", "accommodation_details", "room", "roomno", "roomnumber", "hostel", "block", "allotment"],
      lunchpermitted: ["lunchpermitted", "lunch_permitted", "lunch", "lunchpass"],
      dinnerpermitted: ["dinnerpermitted", "dinner_permitted", "dinner", "dinnerpass"]
    };

    let totalImportedAcrossFiles = 0;
    const processReports = [];

    // 4. Process each CSV file
    for (const file of allFiles) {
      const fileName = file.getName();
      if (fileName.startsWith("[PROCESSED_")) continue; // Skip if already marked

      const csvContent = file.getBlob().getDataAsString("UTF-8");
      const parsedData = Utilities.parseCsv(csvContent);

      if (!parsedData || parsedData.length < 2) {
        processReports.push(`${fileName}: Skipped (empty or no data rows)`);
        continue;
      }

      const csvHeaders = parsedData[0].map(h => String(h).trim());
      const dataRows = parsedData.slice(1);

      // Build column mapping: index in CSV -> index in Master (0-based)
      // Master Column 0 (Participant_ID) MUST stay blank.
      const colMap = new Array(totalCols).fill(-1);

      for (let m = 1; m < totalCols; m++) {
        const mHeaderNorm = normalize(masterHeaders[m]);
        const acceptableAliases = aliases[mHeaderNorm] || [mHeaderNorm];

        for (let c = 0; c < csvHeaders.length; c++) {
          const cHeaderNorm = normalize(csvHeaders[c]);
          if (acceptableAliases.includes(cHeaderNorm)) {
            colMap[m] = c;
            break;
          }
        }
      }

      // Check if essential columns (at least Name or Email) were mapped
      const nameColMapped = colMap[1] !== -1;
      const emailColMapped = colMap[2] !== -1;

      if (!nameColMapped && !emailColMapped) {
        processReports.push(`${fileName}: FAILED (Could not map Full_Name or Email_Address headers)`);
        continue;
      }

      // 5. Read existing participants to prevent duplicate imports (by Email or Phone)
      const existingLastRow = masterSheet.getLastRow();
      const existingEmails = new Set();
      const existingPhones = new Set();

      if (existingLastRow > 1) {
        const existingData = masterSheet.getRange(2, 1, existingLastRow - 1, totalCols).getValues();
        for (let e = 0; e < existingData.length; e++) {
          const em = String(existingData[e][2] || "").trim().toLowerCase();
          const ph = String(existingData[e][3] || "").replace(/[^0-9]/g, "").trim();
          if (em) existingEmails.add(em);
          if (ph && ph.length >= 10) existingPhones.add(ph);
        }
      }

      // 6. Construct rows to append with de-duplication & smart fallbacks
      const rowsToAppend = [];
      let skippedDuplicates = 0;

      for (let r = 0; r < dataRows.length; r++) {
        const rawRow = dataRows[r];
        if (rawRow.every(cell => String(cell).trim() === "")) continue;

        const newRow = new Array(totalCols).fill("");
        newRow[0] = ""; // Participant_ID left empty for generator

        for (let m = 1; m < totalCols; m++) {
          const csvColIndex = colMap[m];
          if (csvColIndex !== -1 && csvColIndex < rawRow.length) {
            newRow[m] = String(rawRow[csvColIndex] || "").trim();
          }
        }

        const email = String(newRow[2] || "").trim().toLowerCase();
        const phone = String(newRow[3] || "").replace(/[^0-9]/g, "").trim();

        // Check for duplicates
        if ((email && existingEmails.has(email)) || (phone && phone.length >= 10 && existingPhones.has(phone))) {
          skippedDuplicates++;
          continue;
        }

        // Smart defaults if columns were not explicitly present in raw CSV
        // Stay_Status (Index 8)
        if (!newRow[8]) {
          const rawRowStr = rawRow.join(" ").toLowerCase();
          newRow[8] = (rawRowStr.includes("resident") || rawRowStr.includes("hostel")) ? "RESIDENT" : "NON-RESIDENT";
        }
        // Accommodation_Details (Index 9)
        if (!newRow[9]) {
          newRow[9] = newRow[8] === "RESIDENT" ? "Pending Room Allotment" : "N/A";
        }
        // Lunch_Permitted (Index 10)
        if (!newRow[10]) {
          newRow[10] = "TRUE";
        }
        // Dinner_Permitted (Index 11)
        if (!newRow[11]) {
          newRow[11] = newRow[8] === "RESIDENT" ? "TRUE" : "FALSE";
        }

        if (newRow[1] || newRow[2] || newRow[3]) {
          rowsToAppend.push(newRow);
          if (email) existingEmails.add(email);
          if (phone && phone.length >= 10) existingPhones.add(phone);
        }
      }

      if (rowsToAppend.length === 0) {
        processReports.push(`${fileName}: 0 new records (Skipped ${skippedDuplicates} duplicate(s))`);
        continue;
      }

      // 7. Safe Batch Append to 01_Participants_Master
      const startRow = masterSheet.getLastRow() + 1;
      masterSheet.getRange(startRow, 1, rowsToAppend.length, totalCols).setValues(rowsToAppend);
      totalImportedAcrossFiles += rowsToAppend.length;

      // 7. Archive or Rename the File to guarantee Idempotency
      const timestampStr = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyyMMdd_HHmmss");
      if (archiveFolder) {
        file.moveTo(archiveFolder);
        file.setName(`[IMPORTED_${timestampStr}]_${fileName}`);
      } else {
        file.setName(`[PROCESSED_${timestampStr}]_${fileName}`);
      }

      processReports.push(`${fileName}: Imported ${rowsToAppend.length} records`);
    }

    // 8. Log outcome to 05_Automation_Log
    const status = totalImportedAcrossFiles > 0 ? "Success" : "No Data";
    const details = processReports.join(" | ") + (totalImportedAcrossFiles > 0 ? ". Run generateParticipantIDs() to assign IDs." : "");
    logAutomation("CSV Import", totalImportedAcrossFiles, status, details);

    Logger.log(`CSV Import Complete: ${totalImportedAcrossFiles} records imported.`);
  } catch (error) {
    logAutomation("CSV Import", 0, "Failed", error.toString());
    Logger.log("Error during CSV Import: " + error.toString());
  } finally {
    lock.releaseLock();
  }
}
