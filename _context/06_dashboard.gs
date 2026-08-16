/**
 * JAI Conclave 2026 - Live Dashboard Builder
 * File: 06_dashboard.gs
 * Phase 6: Automated Dashboard Generation
 */

function buildLiveDashboard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dashSheet = ss.getSheetByName("06_Live_Dashboard");
  
  if (!dashSheet) {
    SpreadsheetApp.getUi().alert("Dashboard sheet not found! Please ensure '06_Live_Dashboard' exists.");
    return;
  }
  
  // 1. Clear existing sheet and unfreeze rows to prevent merge errors
  dashSheet.clear();
  dashSheet.setFrozenRows(0);
  dashSheet.setFrozenColumns(0);
  
  // 2. Set Column Widths for better UI
  dashSheet.setColumnWidth(1, 20);  // Spacer
  dashSheet.setColumnWidth(2, 200); // KPI 1
  dashSheet.setColumnWidth(3, 200); // KPI 2
  dashSheet.setColumnWidth(4, 200); // KPI 3
  dashSheet.setColumnWidth(5, 200); // KPI 4
  dashSheet.setColumnWidth(6, 250); // Extra data
  
  // 3. Main Title
  dashSheet.getRange("B1:E2").merge();
  const titleRange = dashSheet.getRange("B1");
  titleRange.setValue("JAI Conclave 2026 - Live Command Center")
            .setFontSize(18)
            .setFontWeight("bold")
            .setBackground("#2c3e50")
            .setFontColor("#ffffff")
            .setHorizontalAlignment("center")
            .setVerticalAlignment("middle");
            
  // 4. KPI Headers
  const kpiHeaders = [["Total Registered", "Checked-In (ENT)", "Check-in Rate", "Lunches Claimed (CAFD1)"]];
  dashSheet.getRange("B4:E4").setValues(kpiHeaders)
           .setFontWeight("bold")
           .setBackground("#ecf0f1")
           .setHorizontalAlignment("center");
           
  // 5. KPI Formulas
  // - Total Registered: Counts IDs in Master
  // - Checked-In: Counts successful 'ENT' scans
  // - Rate: Checked-In / Total
  // - Meals: Counts successful 'CAFD1' scans
  const kpiFormulas = [[
    `=COUNTA('01_Participants_Master'!A2:A)`,
    `=COUNTIFS('03_Activity_Log'!C:C, "ENT", '03_Activity_Log'!E:E, "Success")`,
    `=IF(B5=0, 0, C5/B5)`,
    `=COUNTIFS('03_Activity_Log'!C:C, "CAFD1", '03_Activity_Log'!E:E, "Success")`
  ]];
  dashSheet.getRange("B5:E5").setFormulas(kpiFormulas)
           .setFontSize(24)
           .setFontWeight("bold")
           .setHorizontalAlignment("center");
           
  // Format Check-in Rate as Percentage
  dashSheet.getRange("D5").setNumberFormat("0.0%");
  
  // 6. Section Titles
  dashSheet.getRange("B8:C8").merge().setValue("Live Checkpoint Statistics").setFontWeight("bold").setBackground("#ecf0f1").setFontSize(14);
  dashSheet.getRange("E8:F8").merge().setValue("Recent Activity Log (Last 15 Scans)").setFontWeight("bold").setBackground("#ecf0f1").setFontSize(14);
  
  // 7. Inject Live Queries
  // Checkpoint Stats: Groups by Checkpoint ID and counts successful scans
  dashSheet.getRange("B9").setFormula(`=QUERY('03_Activity_Log'!A:F, "SELECT C, COUNT(B) WHERE E='Success' AND C IS NOT NULL GROUP BY C LABEL C 'Checkpoint', COUNT(B) 'Total Scans'", 1)`);
  
  // Recent Activity: Pulls the last 15 rows from the activity log
  dashSheet.getRange("E9").setFormula(`=QUERY('03_Activity_Log'!A:G, "SELECT A, B, C, D, E WHERE B IS NOT NULL ORDER BY A DESC LIMIT 15", 1)`);
  
  // 8. General Formatting
  dashSheet.getRange("B9:C20").setBackground("#f9f9f9");
  dashSheet.getRange("E9:I25").setBackground("#f9f9f9");
  
  // Remove gridlines for a cleaner "app" look
  dashSheet.setHiddenGridlines(true);
  
  SpreadsheetApp.getUi().alert("Dashboard successfully built!");
}
