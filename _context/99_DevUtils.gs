/**
 * JAI Conclave 2026 - Developer Utilities
 * File: 99_DevUtils.gs
 * IMPORTANT: Delete this file before the live event!
 */

/**
 * 1. AUTO-REPAIR TOOL
 * Fixes headers, injects missing formulas, and formats dates in 02_Operational_State.
 */
function repairOperationalState() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const opSheet = ss.getSheetByName("02_Operational_State");
  const MAX_ROWS = 3500;
  
  // 1. Fix Headers (Certificates Removed. Admin_Remarks is now the final column)
  const headers = [["Participant_ID", "Badge_Issued_At", "Last_Scan_At", "Last_Known_Location", "Meals_Claimed", "QR_Drive_URL", "ID_Card_Drive_URL", "Email_Sent_At", "Email_Delivery_Status", "Email_Retry_Count", "Admin_Remarks"]];
  opSheet.getRange(1, 1, 1, headers[0].length).setValues(headers).setFontWeight("bold").setBackground("#f3f3f3");
  
  // 2. Inject Formulas in Row 2 (Cols A through E)
  opSheet.getRange("A2").setFormula(`=ARRAYFORMULA(IF('01_Participants_Master'!A2:A${MAX_ROWS}="", "", '01_Participants_Master'!A2:A${MAX_ROWS}))`);
  opSheet.getRange("B2").setFormula(`=MAP(A2:A, LAMBDA(id, IF(id="", "", IFERROR(1/(1/MINIFS('03_Activity_Log'!A:A, '03_Activity_Log'!B:B, id, '03_Activity_Log'!C:C, "BAD", '03_Activity_Log'!E:E, "Success")), ""))))`);
  opSheet.getRange("C2").setFormula(`=MAP(A2:A, LAMBDA(id, IF(id="", "", IFERROR(1/(1/MAXIFS('03_Activity_Log'!A:A, '03_Activity_Log'!B:B, id, '03_Activity_Log'!E:E, "Success")), ""))))`);
  opSheet.getRange("D2").setFormula(`=MAP(A2:A, LAMBDA(id, IF(id="", "", IFERROR(XLOOKUP(id, '03_Activity_Log'!B:B, '03_Activity_Log'!C:C, "", 0, -1), ""))))`);
  opSheet.getRange("E2").setFormula(`=MAP(A2:A, LAMBDA(id, IF(id="", "", COUNTIFS('03_Activity_Log'!B:B, id, '03_Activity_Log'!C:C, "CAFD1", '03_Activity_Log'!E:E, "Success"))))`);
  
  // 3. Format Date Columns
  opSheet.getRange(`B2:C${MAX_ROWS}`).setNumberFormat("m/d/yyyy h:mm:ss");
  opSheet.getRange(`H2:H${MAX_ROWS}`).setNumberFormat("m/d/yyyy h:mm:ss");

  // 4. Fix Email Status Dropdown (Col I)
  opSheet.getRange(`H2:H${MAX_ROWS}`).clearDataValidations(); 
  const emailStatusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["Pending", "Success", "Failed", "Bounced"], true)
    .setAllowInvalid(true) 
    .build();
  opSheet.getRange(`I2:I${MAX_ROWS}`).setDataValidation(emailStatusRule);
  
  Logger.log("Operational State successfully repaired (Certificate free!).");
}

/**
 * 2. FACTORY RESET TOOL (CACHE REMOVE)
 * Wipes all experimental data, logs, and resets the ID counter to 0.
 * Leaves configuration and formulas completely intact.
 */
function factoryResetEMD() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. Clear Participants Master
  const masterSheet = ss.getSheetByName("01_Participants_Master");
  if (masterSheet.getLastRow() > 1) {
    masterSheet.getRange(2, 1, masterSheet.getLastRow(), masterSheet.getLastColumn()).clearContent();
  }
  
  // 2. Clear Operational State (Clear Col F to K, leaving formulas in A to E intact)
  const opSheet = ss.getSheetByName("02_Operational_State");
  if (opSheet.getLastRow() > 1) {
    opSheet.getRange(2, 6, opSheet.getMaxRows(), 6).clearContent(); 
  }
  
  // 3. Clear Logs
  const logsToClear = ["03_Activity_Log", "04_Admin_Actions", "05_Automation_Log"];
  logsToClear.forEach(sheetName => {
    let sheet = ss.getSheetByName(sheetName);
    if (sheet && sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow(), sheet.getLastColumn()).clearContent();
    }
  });
  
  // 4. Reset the Participant ID Counter to 0
  const configSheet = ss.getSheetByName("00_Configuration");
  const configData = configSheet.getRange("A:B").getValues();
  for (let i = 0; i < configData.length; i++) {
    if (String(configData[i][0]).trim() === "Last_Participant_Sequence") {
      configSheet.getRange(i + 1, 2).setValue(0);
      break;
    }
  }
  
  Logger.log("Factory Reset Complete. All test data has been wiped.");
}

/**
 * 3. AUTO-PROVISION VOLUNTEER ROSTER
 * Generates unique VOL-XX IDs with secure random 4-digit PINs.
 */
function setupVolunteerRoster() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const configSheet = ss.getSheetByName("00_Configuration");
  if (!configSheet) return;

  const count = 50; // Total volunteers
  const startRow = 2; // Assuming row 2 is the start of Volunteer config (Col J to N)
  
  const newData = [];
  
  for (let i = 1; i <= count; i++) {
    const volId = "VOL-" + String(i).padStart(2, '0');
    // Generate secure PIN (exclude simple ones like 1234, 0000, 1111)
    let pin;
    do {
      pin = String(Math.floor(1000 + Math.random() * 9000));
    } while (pin === "1234" || pin[0] === pin[1] && pin[1] === pin[2] && pin[2] === pin[3]);
    
    // Checkpoints: "ALL" for VOL-01 (Admin), others blank by default
    const checkpoints = (i === 1) ? "ALL" : "";
    newData.push([volId, `Volunteer ${i}`, pin, "TRUE", checkpoints]);
  }
  
  // Clear old data (Col J to N)
  configSheet.getRange(startRow, 10, Math.max(100, configSheet.getLastRow()), 5).clearContent();
  
  // Set new data
  configSheet.getRange(startRow, 10, newData.length, 5).setValues(newData);
  Logger.log(`Successfully provisioned ${count} volunteers.`);
}
