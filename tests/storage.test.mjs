import assert from "node:assert/strict";
import test from "node:test";

// storage.mjs holds module-level state (the cache and DB handle), so every
// scenario imports a fresh copy via a cache-busting query string.
let importCounter = 0;
async function freshStorage() {
  importCounter += 1;
  return import(`../app/storage.mjs?test=${importCounter}`);
}

// Minimal in-memory stand-ins for the browser APIs storage.mjs touches.
// Requests settle in microtasks and transactions complete in a macrotask,
// mirroring the real API's "request success before transaction complete"
// ordering.

function createFakeLocalStorage() {
  const map = new Map();
  return {
    get length() { return map.size; },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
}

function makeRequest(execute) {
  const request = { onsuccess: null, onerror: null, result: undefined, error: null };
  queueMicrotask(() => {
    try {
      request.result = execute();
      request.onsuccess?.({ target: request });
    } catch (error) {
      request.error = error;
      request.onerror?.({ target: request });
    }
  });
  return request;
}

function makeStoreHandle(records) {
  const sortedKeys = () => [...records.keys()].sort();
  return {
    put: (value, key) => makeRequest(() => { records.set(key, structuredClone(value)); return key; }),
    delete: (key) => makeRequest(() => { records.delete(key); }),
    getAllKeys: () => makeRequest(() => sortedKeys()),
    getAll: () => makeRequest(() => sortedKeys().map((key) => structuredClone(records.get(key)))),
  };
}

function makeDbHandle(dbData) {
  return {
    objectStoreNames: { contains: (name) => dbData.stores.has(name) },
    createObjectStore(name) {
      dbData.stores.set(name, new Map());
      return {};
    },
    transaction(name) {
      const transaction = {
        oncomplete: null,
        onerror: null,
        onabort: null,
        error: null,
        objectStore: () => makeStoreHandle(dbData.stores.get(name)),
      };
      // Requests settle in microtasks; the transaction completes afterwards.
      setTimeout(() => transaction.oncomplete?.({ target: transaction }), 0);
      return transaction;
    },
    close() {},
  };
}

function createFakeIndexedDb() {
  const databases = new Map();
  return {
    databases,
    open(name, version) {
      const request = { onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null, result: null, error: null };
      queueMicrotask(() => {
        let dbData = databases.get(name);
        if (!dbData) {
          dbData = { version: 0, stores: new Map() };
          databases.set(name, dbData);
        }
        request.result = makeDbHandle(dbData);
        if (version > dbData.version) {
          dbData.version = version;
          request.onupgradeneeded?.({ target: request });
        }
        request.onsuccess?.({ target: request });
      });
      return request;
    },
  };
}

function installFakes({ withIndexedDb = true } = {}) {
  const fakeLocalStorage = createFakeLocalStorage();
  const fakeIndexedDb = withIndexedDb ? createFakeIndexedDb() : undefined;
  globalThis.localStorage = fakeLocalStorage;
  if (withIndexedDb) {
    globalThis.indexedDB = fakeIndexedDb;
  } else {
    delete globalThis.indexedDB;
  }
  return { fakeLocalStorage, fakeIndexedDb };
}

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

function idbRecords(fakeIndexedDb) {
  return fakeIndexedDb.databases.get("gpx-rider")?.stores.get("kv") ?? new Map();
}

test("reads and writes round-trip through IndexedDB", async () => {
  const { fakeIndexedDb, fakeLocalStorage } = installFakes();
  const storage = await freshStorage();
  await storage.initStorage();

  assert.equal(storage.readJson("gpx-rider:settings"), null);
  assert.equal(storage.writeJson("gpx-rider:settings", { riderWeight: 80 }), true);
  assert.deepEqual(storage.readJson("gpx-rider:settings"), { riderWeight: 80 });

  await settle();
  assert.deepEqual(idbRecords(fakeIndexedDb).get("gpx-rider:settings"), { riderWeight: 80 });
  // IndexedDB mode must not touch localStorage.
  assert.equal(fakeLocalStorage.getItem("gpx-rider:settings"), null);

  storage.removeStored("gpx-rider:settings");
  assert.equal(storage.readJson("gpx-rider:settings"), null);
  await settle();
  assert.equal(idbRecords(fakeIndexedDb).has("gpx-rider:settings"), false);
});

test("values persist across a restart", async () => {
  const fakes = installFakes();
  const first = await freshStorage();
  await first.initStorage();
  first.writeJson("gpx-rider:last-ride", { progressMeters: 1234 });
  await settle();

  // Same fake browser, fresh module = page reload.
  globalThis.indexedDB = fakes.fakeIndexedDb;
  const second = await freshStorage();
  await second.initStorage();
  assert.deepEqual(second.readJson("gpx-rider:last-ride"), { progressMeters: 1234 });
});

test("migrates legacy localStorage records into IndexedDB", async () => {
  const { fakeIndexedDb, fakeLocalStorage } = installFakes();
  fakeLocalStorage.setItem("gpx-rider:ride-log", JSON.stringify({ samples: [[1, 2, 3]] }));
  fakeLocalStorage.setItem("gpx-rider:maps-api-key", "raw-key-not-json");
  fakeLocalStorage.setItem("unrelated", "leave-me");

  const storage = await freshStorage();
  await storage.initStorage();

  assert.deepEqual(storage.readJson("gpx-rider:ride-log"), { samples: [[1, 2, 3]] });
  await settle();
  assert.deepEqual(idbRecords(fakeIndexedDb).get("gpx-rider:ride-log"), { samples: [[1, 2, 3]] });
  // Migrated records leave localStorage; the maps key and foreign keys stay.
  assert.equal(fakeLocalStorage.getItem("gpx-rider:ride-log"), null);
  assert.equal(fakeLocalStorage.getItem("gpx-rider:maps-api-key"), "raw-key-not-json");
  assert.equal(fakeLocalStorage.getItem("unrelated"), "leave-me");
});

test("an existing IndexedDB record wins over a stale localStorage copy", async () => {
  const fakes = installFakes();
  const first = await freshStorage();
  await first.initStorage();
  first.writeJson("gpx-rider:settings", { units: "imperial" });
  await settle();

  fakes.fakeLocalStorage.setItem("gpx-rider:settings", JSON.stringify({ units: "metric" }));
  globalThis.indexedDB = fakes.fakeIndexedDb;
  const second = await freshStorage();
  await second.initStorage();

  assert.deepEqual(second.readJson("gpx-rider:settings"), { units: "imperial" });
  assert.equal(fakes.fakeLocalStorage.getItem("gpx-rider:settings"), null);
});

test("falls back to localStorage when IndexedDB is unavailable", async () => {
  const { fakeLocalStorage } = installFakes({ withIndexedDb: false });
  const storage = await freshStorage();
  await storage.initStorage();

  assert.equal(storage.writeJson("gpx-rider:settings", { riderWeight: 72 }), true);
  assert.equal(fakeLocalStorage.getItem("gpx-rider:settings"), JSON.stringify({ riderWeight: 72 }));
  assert.deepEqual(storage.readJson("gpx-rider:settings"), { riderWeight: 72 });

  storage.removeStored("gpx-rider:settings");
  assert.equal(fakeLocalStorage.getItem("gpx-rider:settings"), null);
});

test("fallback writeJson reports quota failures", async () => {
  const { fakeLocalStorage } = installFakes({ withIndexedDb: false });
  fakeLocalStorage.setItem = () => { throw new Error("QuotaExceededError"); };
  const storage = await freshStorage();
  await storage.initStorage();

  assert.equal(storage.writeJson("gpx-rider:ride-log", { samples: [] }), false);
});
