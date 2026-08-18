/**
 * DemoFormExporter.gs
 * -------------------------------------------------------------
 * Standalone Google Form Response Sheet Exporter for JAI Conclave 2026.
 * 
 * FEATURES:
 * - Zero code editing required: set Drive Folder via the "⚙️ Set Drive Export Folder" menu popup!
 * - Also supports a dedicated "_Config" or "Settings" tab if preferred.
 * - Accepts either raw Folder IDs or full Google Drive folder URLs.
 * -------------------------------------------------------------
 */

/**
 * Automatically creates the custom menu when the Google Sheet opens.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("JAI Conclave")
    .addItem("📤 Export Batch to Drive", "exportBatchToDrive")
    .addItem("⚙️ Set Drive Export Folder", "promptSetDriveFolder")
    .addSeparator()
    .addItem("🔄 Mark All as Ready for Export", "resetExportStatus")
    .addToUi();
}

/**
 * Helper to get or prompt for the Google Drive Export Folder ID.
 */
function getExportFolderId() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. Check if a '_Config' or 'Settings' sheet has cell B1/B2 set
  const configSheets = ["_Config", "Settings", "Config", "Configuration"];
  for (const name of configSheets) {
    const s = ss.getSheetByName(name);
    if (s) {
      const data = s.getRange("A1:B10").getValues();
      for (let i = 0; i < data.length; i++) {
        const key = String(data[i][0] || "").toLowerCase();
        if (key.includes("folder") || key.includes("drive") || key.includes("export")) {
          const val = String(data[i][1] || "").trim();
          if (val && !val.includes("INSERT")) return extractFolderId(val);
        }
      }
    }
  }

  // 2. Check Document Properties (saved via menu)
  const props = PropertiesService.getDocumentProperties();
  const savedId = props.getProperty("DRIVE_EXPORT_FOLDER_ID");
  if (savedId) return savedId;

  return "";
}

/**
 * Cleanly extracts a Google Drive Folder ID from a URL or raw ID string.
 */
function extractFolderId(input) {
  const str = String(input || "").trim();
  const match = str.match(/folders\/([-\w]{25,})/i) || str.match(/[-\w]{25,}/);
  return match ? match[1] || match[0] : str;
}

/**
 * UI Popup allowing user to paste their Google Drive folder URL or ID without opening Apps Script!
 */
function promptSetDriveFolder() {
  const ui = SpreadsheetApp.getUi();
  const currentId = getExportFolderId();
  
  const response = ui.prompt(
    "⚙️ Configure Google Drive Export Folder",
    `Paste your Google Drive Folder URL or Folder ID below:\n` +
    (currentId ? `(Current Folder ID: ${currentId})\n` : ""),
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() === ui.Button.OK) {
    const input = response.getResponseText().trim();
    if (!input) {
      ui.alert("No Input", "Folder setting was not changed.", ui.ButtonSet.OK);
      return;
    }

    const folderId = extractFolderId(input);
    try {
      const folder = DriveApp.getFolderById(folderId);
      PropertiesService.getDocumentProperties().setProperty("DRIVE_EXPORT_FOLDER_ID", folderId);
      ui.alert("Success! 🎉", `Linked successfully to Drive folder:\n📁 "${folder.getName()}"`, ui.ButtonSet.OK);
    } catch (e) {
      ui.alert("Folder Error ❌", "Cannot access that Google Drive folder. Please ensure the link/ID is correct and you have edit permissions.", ui.ButtonSet.OK);
    }
  }
}

/**
 * Main export function: transforms Google Form columns into EMD 12-column format
 * and exports a timestamped CSV directly into your Google Drive import folder.
 */
function exportBatchToDrive() {
  const ui = SpreadsheetApp.getUi();
  let folderId = getExportFolderId();

  // If not configured, prompt the user right now!
  if (!folderId) {
    promptSetDriveFolder();
    folderId = getExportFolderId();
    if (!folderId) return;
  }

  let folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (e) {
    ui.alert("Folder Error", "Cannot access the configured Google Drive folder. Please click 'JAI Conclave > ⚙️ Set Drive Export Folder' to update it.", ui.ButtonSet.OK);
    return;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastRow < 2) {
    ui.alert("No Data", "No response rows found to export.", ui.ButtonSet.OK);
    return;
  }

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  // Helper normalizer
  const norm = (str) => String(str || "").toLowerCase().replace(/[^a-z0-9]/g, "");

  // Dynamic Column Resolver
  const findCol = (aliases) => {
    for (let c = 0; c < headers.length; c++) {
      const h = norm(headers[c]);
      for (const a of aliases) {
        if (h.includes(norm(a))) return c;
      }
    }
    return -1;
  };

  const colName = findCol(["fullname", "name", "studentname", "delegatename", "attendee"]);
  const colEmail = findCol(["emailaddress", "email", "mail"]);
  const colPhone = findCol(["contactnumber", "contact", "phonenumber", "phone", "mobile", "whatsapp"]);
  const colCollege = findCol(["college", "university", "institution", "school"]);
  const colTrack = findCol(["council", "track", "committee", "domain", "stream"]);
  const colSubTrack = findCol(["venture", "subtrack", "sub_track", "founder", "startup"]);
  const colType = findCol(["participate", "participanttype", "role", "designation", "tickettype"]);
  const colStay = findCol(["mode", "stay", "residential", "accommodation", "hostel"]);
  let colExported = findCol(["exportedtoemd", "exported", "syncstatus"]);

  // Auto-create Exported_To_EMD column if not present
  if (colExported === -1) {
    colExported = lastCol;
    sheet.getRange(1, colExported + 1).setValue("Exported_To_EMD").setFontWeight("bold");
  }

  const emdHeaders = [
    "Participant_ID",
    "Full_Name",
    "Email_Address",
    "Phone_Number",
    "Institution",
    "Track",
    "Sub_Track",
    "Participant_Type",
    "Stay_Status",
    "Accommodation_Details",
    "Lunch_Permitted",
    "Dinner_Permitted"
  ];

  const exportRows = [emdHeaders];
  const rowsToMarkExported = [];

  for (let r = 0; r < data.length; r++) {
    const row = data[r];
    const rowIndex = r + 2;

    // Check if already exported
    const isExported = colExported < row.length && String(row[colExported]).trim().toUpperCase() === "TRUE";
    if (isExported) continue;

    const fullName = colName !== -1 ? String(row[colName]).trim() : "";
    const email = colEmail !== -1 ? String(row[colEmail]).trim().toLowerCase() : "";
    let phone = colPhone !== -1 ? String(row[colPhone]).replace(/[^0-9+]/g, "").trim() : "";
    if (phone.startsWith("+91")) phone = phone.substring(3);

    // Skip empty rows
    if (!fullName && !email) continue;

    const institution = colCollege !== -1 ? String(row[colCollege]).trim() : "";
    const track = colTrack !== -1 ? String(row[colTrack]).trim() : "General";
    const subTrack = colSubTrack !== -1 ? String(row[colSubTrack]).trim() : "";
    const pType = colType !== -1 && String(row[colType]).trim() ? String(row[colType]).trim() : "Delegate";

    const rawStay = colStay !== -1 ? String(row[colStay]).toLowerCase() : "";
    const isResident = rawStay.includes("resident") || rawStay.includes("hostel") || rawStay.includes("stay") || rawStay.includes("yes");
    const stayStatus = isResident ? "RESIDENT" : "NON-RESIDENT";
    const accDetails = isResident ? "Pending Room Allotment" : "N/A";
    const lunchPermitted = "TRUE";
    const dinnerPermitted = isResident ? "TRUE" : "FALSE";

    exportRows.push([
      "",
      fullName,
      email,
      phone,
      institution,
      track,
      subTrack,
      pType,
      stayStatus,
      accDetails,
      lunchPermitted,
      dinnerPermitted
    ]);

    rowsToMarkExported.push(rowIndex);
  }

  const exportCount = exportRows.length - 1;

  if (exportCount === 0) {
    ui.alert("No New Records", "No new or verified participants found to export.\n\nTip: If using a 'Payment_Verified' column, ensure checked rows have TRUE.", ui.ButtonSet.OK);
    return;
  }

  // Convert array to CSV string
  const csvContent = exportRows.map(row => {
    return row.map(cell => {
      const cellStr = String(cell || "");
      if (cellStr.includes(",") || cellStr.includes('"') || cellStr.includes("\n")) {
        return `"${cellStr.replace(/"/g, '""')}"`;
      }
      return cellStr;
    }).join(",");
  }).join("\r\n");

  // Save CSV to Drive
  const timestampStr = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyyMMdd_HHmmss");
  const fileName = `batch_demo_${timestampStr}.csv`;
  const file = folder.createFile(fileName, csvContent, MimeType.CSV);

  // Mark exported rows in Form Sheet
  rowsToMarkExported.forEach(rIndex => {
    sheet.getRange(rIndex, colExported + 1).setValue("TRUE");
  });

  ui.alert(
    "Export Successful! 🚀",
    `Exported ${exportCount} participant(s) to Google Drive:\n\n` +
    `📁 File: ${fileName}\n` +
    `📍 Location: ${folder.getName()}\n\n` +
    `Next Step:\nOpen your EMD Master Sheet and run 'importCSVData()' to ingest this batch!`,
    ui.ButtonSet.OK
  );
}

/**
 * Utility function to reset the Exported status if you want to re-export during testing.
 */
function resetExportStatus() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert("Reset Export Status", "Do you want to clear the 'Exported_To_EMD' column so all rows can be exported again?", ui.ButtonSet.YES_NO);
  if (response !== ui.Button.YES) return;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastRow < 2) return;

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  for (let c = 0; c < headers.length; c++) {
    if (String(headers[c]).trim().toLowerCase().includes("exported")) {
      sheet.getRange(2, c + 1, lastRow - 1, 1).clearContent();
      ui.alert("Reset Complete", "All rows are now marked ready for export.", ui.ButtonSet.OK);
      return;
    }
  }
  ui.alert("No Column Found", "Could not find 'Exported_To_EMD' column.", ui.ButtonSet.OK);
}
