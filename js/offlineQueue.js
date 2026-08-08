/**
 * offlineQueue.js
 * ---------------------------------------------------------------
 * Stores scans locally (IndexedDB) when the network is unavailable
 * or a request fails, and replays them via Api.bulkSync() once
 * connectivity returns. clientScanId is the idempotency key that
 * makes replay safe even if a request actually succeeded before
 * the failure was detected.
 * ---------------------------------------------------------------
 */
const OfflineQueue = (() => {
  const DB_NAME = "emd_offline_db";
  const DB_VERSION = 1;
  const STORE = "pending_scans";

  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "clientScanId" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function add(scan) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(scan);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getAll() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function count() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => reject(req.error);
    });
  }

  async function remove(clientScanId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(clientScanId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function removeMany(clientScanIds) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      clientScanIds.forEach((id) => store.delete(id));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Attempts to flush the queue to the backend in batches.
   * Removes any entries the server confirms it has recorded
   * (SUCCESS or DUPLICATE_SCAN both count as "handled").
   * Entries that come back as AUTH_FAILED are also removed and
   * surfaced, since retrying them won't help until re-login.
   * Returns a summary object for the UI to react to.
   */
  async function sync(onProgress) {
    const summary = { synced: 0, duplicates: 0, failed: 0, authFailed: false };
    const all = await getAll();
    if (all.length === 0) return summary;

    for (let i = 0; i < all.length; i += Config.SYNC_BATCH_SIZE) {
      const batch = all.slice(i, i + Config.SYNC_BATCH_SIZE);
      let response;
      try {
        response = await Api.bulkSync(batch);
      } catch (err) {
        // Network still down (or backend error) — stop, keep everything queued.
        break;
      }

      const results = (response && response.results) || [];
      const toRemove = [];
      results.forEach((r) => {
        if (r.status === "SUCCESS") {
          summary.synced++;
          toRemove.push(r.clientScanId);
        } else if (r.status === "DUPLICATE_SCAN") {
          summary.duplicates++;
          toRemove.push(r.clientScanId);
        } else if (r.status === "AUTH_FAILED") {
          summary.authFailed = true;
          toRemove.push(r.clientScanId);
        } else {
          // INVALID_ID, INVALID_CHECKPOINT, ERROR, TIMEOUT, etc.
          // Leave in the queue is not useful (it will never become valid),
          // except TIMEOUT which is worth retrying — keep those queued.
          if (r.status === "TIMEOUT") {
            summary.failed++;
          } else {
            summary.failed++;
            toRemove.push(r.clientScanId);
          }
        }
      });

      if (toRemove.length) await removeMany(toRemove);
      if (onProgress) onProgress(await count());
    }

    return summary;
  }

  return { add, getAll, count, remove, removeMany, sync };
})();
