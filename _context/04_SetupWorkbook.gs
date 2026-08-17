/**
 * 04_SetupWorkbook.gs
 * -------------------------------------------------------------
 * One-time workbook schema initializer for JAI Conclave 2026.
 * Creates all 7 relational sheets with formulas, dropdowns, and header styles.
 * -------------------------------------------------------------
 */

function setupWorkbook() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const MAX_ROWS = 3500;
  
  const schemas = {
    "00_Configuration": [
      ["Global_Variable", "Value", "", "Checkpoint_ID", "Checkpoint_Name", "Duplicate_Allowed", "Active", "Entitlement_Rule", "", "Volunteer_ID", "Name", "PIN", "Active", "Assigned_Checkpoints"],
      ["Event_Prefix", "JAI", "", "ENT", "Main Entrance", "FALSE", "TRUE", "", "", "ADM-01", "Event Executive", "123456", "TRUE", "ALL"],
      ["Event_Year", "26", "", "BAD", "Badge Collection", "FALSE", "TRUE", "", "", "", "", "", "", ""],
      ["QR_Folder_ID", "[INSERT_ID]", "", "CAFD1", "Lunch Day 1", "FALSE", "TRUE", "LUNCH", "", "", "", "", "", ""],
      ["ID_Card_Folder_ID", "[INSERT_ID]", "", "COU", "Council Session", "TRUE", "TRUE", "", "", "", "", "", "", ""]
    ],
    "01_Participants_Master": [
      ["Participant_ID", "Full_Name", "Email_Address", "Phone_Number", "Institution", "Track", "Sub_Track", "Participant_Type", "Stay_Status", "Accommodation_Details", "Lunch_Permitted", "Dinner_Permitted"]
    ],
    "02_Operational_State": [
      ["Participant_ID", "Badge_Issued_At", "Last_Scan_At", "Last_Known_Location", "Meals_Claimed", "QR_Drive_URL", "ID_Card_Drive_URL", "Email_Sent_At", "Email_Delivery_Status", "Email_Retry_Count", "Admin_Remarks"]
    ],
    "03_Activity_Log": [
      ["Timestamp", "Participant_ID", "Checkpoint_ID", "Volunteer_ID", "Scan_Status", "Message", "Client_Scan_ID"]
    ],
    "04_Admin_Actions": [
      ["Timestamp", "Admin_User", "Participant_ID", "Action_Type", "Reason"]
    ],
    "05_Automation_Log": [
      ["Timestamp", "Automation_Name", "Records_Processed", "Status", "Error_Details"]
    ],
    "06_Live_Dashboard": [
      ["Dashboard metrics will be populated in Phase 6."]
    ]
  };

  for (const sheetName in schemas) {
    let sheet = ss.getSheetByName(sheetName);
    let isNew = false;
    
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      isNew = true;
    }
    
    const data = schemas[sheetName];
    if (isNew) {
      sheet.getRange(1, 1, data.length, data[0].length).setValues(data);
    } else {
      sheet.getRange(1, 1, 1, data[0].length).setValues([data[0]]);
    }
    
    try {
      sheet.getRange("1:1").breakApart();
      sheet.setFrozenRows(1);
    } catch (e) {
      Logger.log("Warning: Could not freeze rows for " + sheetName + " due to merged cells.");
    }
    sheet.getRange(1, 1, 1, data[0].length).setFontWeight("bold").setBackground("#f3f3f3");
  }

  const configSheet = ss.getSheetByName("00_Configuration");
  const booleanRule = SpreadsheetApp.newDataValidation().requireValueInList(["TRUE", "FALSE"], true).build();
  configSheet.getRange(`F2:G${MAX_ROWS}`).setDataValidation(booleanRule);
  
  // Fix for the old column L (which used to be Active, but is now PIN)
  configSheet.getRange(`L2:L${MAX_ROWS}`).clearDataValidations();
  configSheet.getRange(`M2:M${MAX_ROWS}`).setDataValidation(booleanRule);

  if (String(configSheet.getRange("J2").getValue()).trim() === "") {
    configSheet.getRange("J2:N2").setValues([["ADM-01", "Event Executive", "123456", "TRUE", "ALL"]]);
  }

  const opSheet = ss.getSheetByName("02_Operational_State");
  opSheet.getRange("A2").setFormula(`=ARRAYFORMULA(IF('01_Participants_Master'!A2:A${MAX_ROWS}="", "", '01_Participants_Master'!A2:A${MAX_ROWS}))`);
  opSheet.getRange("B2").setFormula(`=MAP(A2:A, LAMBDA(id, IF(id="", "", IFERROR(1/(1/MINIFS('03_Activity_Log'!A:A, '03_Activity_Log'!B:B, id, '03_Activity_Log'!C:C, "BAD", '03_Activity_Log'!E:E, "Success")), ""))))`);
  opSheet.getRange("C2").setFormula(`=MAP(A2:A, LAMBDA(id, IF(id="", "", IFERROR(1/(1/MAXIFS('03_Activity_Log'!A:A, '03_Activity_Log'!B:B, id, '03_Activity_Log'!E:E, "Success")), ""))))`);
  opSheet.getRange("D2").setFormula(`=MAP(A2:A, LAMBDA(id, IF(id="", "", IFERROR(XLOOKUP(id, '03_Activity_Log'!B:B, '03_Activity_Log'!C:C, "", 0, -1), ""))))`);
  opSheet.getRange("E2").setFormula(`=MAP(A2:A, LAMBDA(id, IF(id="", "", COUNTIFS('03_Activity_Log'!B:B, id, '03_Activity_Log'!C:C, "CAFD1", '03_Activity_Log'!E:E, "Success"))))`);

  opSheet.getRange(`B2:C${MAX_ROWS}`).setNumberFormat("m/d/yyyy h:mm:ss");
  opSheet.getRange(`H2:H${MAX_ROWS}`).setNumberFormat("m/d/yyyy h:mm:ss");

  const emailStatusRule = SpreadsheetApp.newDataValidation().requireValueInList(["Pending", "Success", "Failed", "Bounced"], true).build();
  opSheet.getRange(`I2:I${MAX_ROWS}`).setDataValidation(emailStatusRule);

  const adminSheet = ss.getSheetByName("04_Admin_Actions");
  const actionTypeRule = SpreadsheetApp.newDataValidation().requireValueInList(["Manual Check-in", "Badge Reprint", "QR Reissue", "Data Correction", "Other"], true).build();
  adminSheet.getRange(`D2:D${MAX_ROWS}`).setDataValidation(actionTypeRule);

  const defaultSheet = ss.getSheetByName("Sheet1");
  if (defaultSheet && ss.getSheets().length > 1) {
    ss.deleteSheet(defaultSheet);
  }

  Logger.log("Phase 1: Workbook Initialization Complete.");
}
