/**
 * 08_DashboardAPI.gs
 * -------------------------------------------------------------
 * Aggregates real-time scan metrics dynamically based on the 
 * Checkpoint schedule in 00_Configuration. 
 * Highly optimized with CacheService to prevent spreadsheet lag.
 * -------------------------------------------------------------
 */

function handleDashboardStats(body) {
  // 1. Verify Admin Authentication (Must be active and have 'ALL' assigned)
  const auth = authenticate(body.volunteerId, body.pin);
  if (!auth.ok || auth.assignedCheckpoints !== "ALL") {
    return { success: false, status: "AUTH_FAILED", message: "Admin privileges required." };
  }
  
  const cache = CacheService.getScriptCache();
  const CACHE_KEY = "DASHBOARD_LIVE_STATS";
  
  // 2. High-speed cache fetch (30 sec TTL)
  const cached = cache.get(CACHE_KEY);
  if (cached) {
    try {
      return { success: true, data: JSON.parse(cached) };
    } catch(e) {}
  }
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 3. Count Expected Participants
  let totalParticipants = 0;
  const masterSheet = ss.getSheetByName("01_Participants_Master");
  if (masterSheet) {
    totalParticipants = Math.max(0, masterSheet.getLastRow() - 1);
  }
  
  // 4. Initialize Checkpoint Metrics from Configuration
  const checkpoints = getCheckpoints(); // Returns array of objects
  const metricsMap = {};
  
  checkpoints.forEach(cp => {
    // We only care about active checkpoints on the schedule
    if (cp.active) {
      metricsMap[cp.id] = { id: cp.id, name: cp.name, count: 0 };
    }
  });
  
  // 5. Aggregate from Activity Log (Append-only ledger)
  const logSheet = ss.getSheetByName("03_Activity_Log");
  const logRows = logSheet ? logSheet.getLastRow() : 0;
  
  if (logRows > 1) {
    // Fast array read of Checkpoint_ID (C=3) and Scan_Status (E=5)
    // Range: (startRow, startCol, numRows, numCols) -> (2, 3, logRows - 1, 3)
    const data = logSheet.getRange(2, 3, logRows - 1, 3).getValues(); 
    for (let i = 0; i < data.length; i++) {
      const cpId = String(data[i][0]).trim().toUpperCase();
      const status = String(data[i][2]).trim().toLowerCase();
      
      // Only tally successful check-ins for active checkpoints
      if (status === "success" && metricsMap[cpId]) {
        metricsMap[cpId].count++;
      }
    }
  }
  
  // 6. Format Response
  const responseData = {
    totalExpected: totalParticipants,
    checkpoints: Object.values(metricsMap),
    timestamp: new Date().toISOString()
  };
  
  // Cache for 30 seconds to handle intense polling smoothly
  try {
    cache.put(CACHE_KEY, JSON.stringify(responseData), 30);
  } catch(e) {}
  
  return { success: true, data: responseData };
}
