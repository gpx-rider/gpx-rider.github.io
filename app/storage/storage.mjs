// Persistence layer for everything the app remembers between visits.
//
// Values live in IndexedDB, which comfortably holds what localStorage's
// ~5 MB quota cannot (a multi-hour ride log, a large GPX route). IndexedDB
// is asynchronous, so an in-memory cache fronts it: initStorage() loads
// every stored record once at startup (startApp() awaits it before anything
// reads), after which readJson/writeJson/removeStored stay synchronous for
// callers — reads hit the cache, writes update the cache immediately and
// flush to IndexedDB in the background.
//
// Records that older versions saved in localStorage are migrated into
// IndexedDB the first time initStorage() runs, so nothing already saved is
// lost. Browsers where IndexedDB is unavailable or broken (some
// private-browsing modes) keep the old localStorage behavior transparently.
//
// One key deliberately stays in localStorage, handled directly in app.js:
// the Maps API key (gpx-rider:maps-api-key). Saving it triggers an
// immediate location.reload(), and only a synchronous write is guaranteed
// to survive that.

const DB_NAME = "gpx-rider";
const DB_VERSION = 1;
const STORE_NAME = "kv";

const LOCAL_STORAGE_ONLY_KEYS = new Set(["gpx-rider:maps-api-key"]);
const MIGRATABLE_KEY_PREFIX = "gpx-rider:";

const cache = new Map();
let db = null; // stays null when IndexedDB is unusable → localStorage fallback
const warnedWriteKeys = new Set();

export async function initStorage() {
  if (typeof indexedDB === "undefined") return;

  try {
    db = await openDatabase();
    await loadCache();
  } catch (error) {
    db = null;
    cache.clear();
    console.warn("IndexedDB unavailable; persistence falls back to localStorage.", error);
    return;
  }

  try {
    await migrateLegacyLocalStorage();
  } catch (error) {
    // Migration trouble must not take down working IndexedDB persistence;
    // the legacy records simply stay in localStorage for a later attempt.
    console.warn("Could not migrate saved data from localStorage.", error);
  }
}

export function readJson(key) {
  if (db) {
    const value = cache.get(key);
    return value === undefined ? null : value;
  }
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

export function writeJson(key, value) {
  if (db) {
    cache.set(key, value);
    idbRequest((store) => store.put(value, key)).then(
      () => warnedWriteKeys.delete(key),
      (error) => {
        // Persist failures repeat every few seconds during a ride — warn once
        // per key until a write succeeds again.
        if (warnedWriteKeys.has(key)) return;
        warnedWriteKeys.add(key);
        console.warn(`Could not persist ${key}.`, error);
      },
    );
    return true;
  }
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn(`Could not persist ${key}.`, error);
    return false;
  }
}

export function removeStored(key) {
  if (db) {
    cache.delete(key);
    idbRequest((store) => store.delete(key)).catch((error) => {
      console.warn(`Could not remove ${key}.`, error);
    });
    return;
  }
  localStorage.removeItem(key);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("IndexedDB open blocked by another tab."));
  });
}

async function loadCache() {
  // getAllKeys and getAll return the same key order, so they pair up.
  const [keys, values] = await Promise.all([
    idbRequest((store) => store.getAllKeys(), "readonly"),
    idbRequest((store) => store.getAll(), "readonly"),
  ]);
  keys.forEach((key, index) => cache.set(key, values[index]));
}

async function migrateLegacyLocalStorage() {
  const legacyKeys = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key?.startsWith(MIGRATABLE_KEY_PREFIX) && !LOCAL_STORAGE_ONLY_KEYS.has(key)) {
      legacyKeys.push(key);
    }
  }
  if (!legacyKeys.length) return;

  for (const key of legacyKeys) {
    // A record already in IndexedDB wins: the app only writes there once
    // migrated, so the localStorage copy is the stale one.
    if (cache.has(key)) continue;
    let value = null;
    try {
      value = JSON.parse(localStorage.getItem(key));
    } catch {
      continue; // unreadable then, unreadable now — leave it alone
    }
    if (value === null) continue;
    cache.set(key, value);
    await idbRequest((store) => store.put(value, key));
  }

  // Only clear localStorage once every copy above committed, so a failure
  // mid-migration never strands data in limbo.
  for (const key of legacyKeys) localStorage.removeItem(key);
}

// Run one operation against the kv store, resolving when the transaction
// commits (not merely when the request succeeds) so callers awaiting a
// write know it is durable.
function idbRequest(operation, mode = "readwrite") {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = operation(transaction.objectStore(STORE_NAME));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error ?? request.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
}
