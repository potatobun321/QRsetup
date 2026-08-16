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

    for (let i = 0; i < configData.length; i++) {
      const key = String(configData[i][0]).trim();
      const val = String(configData[i][1]).trim();
      if (key === "CSV_Import_Folder_ID") importFolderId = val;
      if (key === "CSV_Archive_Folder_ID") archiveFolderId = val;
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
      participanttype: ["participanttype", "participant_type", "type", "role", "designation", "tickettype"]
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

      // 5. Construct rows to append
      const rowsToAppend = [];
      for (let r = 0; r < dataRows.length; r++) {
        const rawRow = dataRows[r];
        // Skip completely empty rows
        if (rawRow.every(cell => String(cell).trim() === "")) continue;

        const newRow = new Array(totalCols).fill("");
        // Column 0 (Participant_ID) is deliberately left empty for sequential ID generator
        newRow[0] = "";

        for (let m = 1; m < totalCols; m++) {
          const csvColIndex = colMap[m];
          if (csvColIndex !== -1 && csvColIndex < rawRow.length) {
            newRow[m] = String(rawRow[csvColIndex] || "").trim();
          }
        }

        // Only append if row contains at least some identifying data
        if (newRow[1] || newRow[2] || newRow[3]) {
          rowsToAppend.push(newRow);
        }
      }

      if (rowsToAppend.length === 0) {
        processReports.push(`${fileName}: 0 valid records found`);
        continue;
      }

      // 6. Safe Batch Append to 01_Participants_Master
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
