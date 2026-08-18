/**
 * DemoFormExporter.gs
 * -------------------------------------------------------------
 * Standalone Google Form Response Sheet Exporter for JAI Conclave 2026.
 * 
 * INSTRUCTIONS:
 * 1. Open your Demo Google Form Responses Spreadsheet.
 * 2. Click Extensions > Apps Script.
 * 3. Delete any default code, paste this entire file, and click Save.
 * 4. Paste your Google Drive Import Folder ID in DRIVE_EXPORT_FOLDER_ID below.
 * 5. Refresh your Google Sheet — a "JAI Conclave" menu will appear!
 * -------------------------------------------------------------
 */

// PASTE your Google Drive Import Folder ID below:
// (Same as CSV_Import_Folder_ID from 00_Configuration in EMD)
const DRIVE_EXPORT_FOLDER_ID = "[INSERT_YOUR_DRIVE_FOLDER_ID_HERE]";

/**
 * Automatically adds a custom menu to the Google Form Responses sheet.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("JAI Conclave")
    .addItem("📤 Export Verified Batch to Drive", "exportVerifiedBatchToDrive")
    .addItem("🔄 Mark All as Ready for Export", "resetExportStatus")
    .addToUi();
}

/**
 * Main export function: transforms Google Form columns into EMD 12-column format
 * and exports a timestamped CSV directly into your Google Drive import folder.
 */
function exportVerifiedBatchToDrive() {
  const ui = SpreadsheetApp.getUi();
  
  if (!DRIVE_EXPORT_FOLDER_ID || DRIVE_EXPORT_FOLDER_ID.includes("INSERT_YOUR")) {
    ui.alert("Configuration Missing", "Please open Apps Script and set your DRIVE_EXPORT_FOLDER_ID at the top of the file.", ui.ButtonSet.OK);
    return;
  }

  let folder;
  try {
    folder = DriveApp.getFolderById(DRIVE_EXPORT_FOLDER_ID.trim());
  } catch (e) {
    ui.alert("Folder Error", "Cannot access Google Drive folder. Please check your DRIVE_EXPORT_FOLDER_ID.", ui.ButtonSet.OK);
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

  // Helper normalizer: strips symbols and lowercases
  const norm = (str) => String(str || "").toLowerCase().replace(/[^a-z0-9]/g, "");

  // Dynamic Column Resolver (finds columns regardless of order in Form)
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
  const colVerified = findCol(["paymentverified", "verified", "paymentstatus", "status"]);
  let colExported = findCol(["exportedtoemd", "exported", "syncstatus"]);

  // If Exported_To_EMD column doesn't exist, create it in the last column + 1
  if (colExported === -1) {
    colExported = lastCol;
    sheet.getRange(1, colExported + 1).setValue("Exported_To_EMD").setFontWeight("bold");
  }

  // EMD Target 12 Headers
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

    // Check verification status (if verification column exists)
    if (colVerified !== -1) {
      const vStatus = String(row[colVerified]).trim().toUpperCase();
      const isVerified = vStatus === "TRUE" || vStatus === "VERIFIED" || vStatus === "PAID" || vStatus === "YES";
      if (!isVerified) continue; // Skip unverified rows
    }

    // Extract & Transform fields
    const fullName = colName !== -1 ? String(row[colName]).trim() : "";
    const email = colEmail !== -1 ? String(row[colEmail]).trim().toLowerCase() : "";
    let phone = colPhone !== -1 ? String(row[colPhone]).replace(/[^0-9+]/g, "").trim() : "";
    if (phone.startsWith("+91")) phone = phone.substring(3);

    // Skip blank rows
    if (!fullName && !email) continue;

    const institution = colCollege !== -1 ? String(row[colCollege]).trim() : "";
    const track = colTrack !== -1 ? String(row[colTrack]).trim() : "General";
    const subTrack = colSubTrack !== -1 ? String(row[colSubTrack]).trim() : "";
    const pType = colType !== -1 && String(row[colType]).trim() ? String(row[colType]).trim() : "Delegate";

    // Smart Stay & Meal Entitlement Derivation
    const rawStay = colStay !== -1 ? String(row[colStay]).toLowerCase() : "";
    const isResident = rawStay.includes("resident") || rawStay.includes("hostel") || rawStay.includes("stay") || rawStay.includes("yes");
    const stayStatus = isResident ? "RESIDENT" : "NON-RESIDENT";
    const accDetails = isResident ? "Pending Room Allotment" : "N/A";
    const lunchPermitted = "TRUE";
    const dinnerPermitted = isResident ? "TRUE" : "FALSE";

    exportRows.push([
      "", // Participant_ID is left blank for EMD sequential generator
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

  // Convert array to CSV string with standard quoting
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
