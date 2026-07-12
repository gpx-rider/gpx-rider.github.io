// Web Bluetooth polyfill on top of @capacitor-community/bluetooth-le.
//
// The GPX Rider web app (../../app) talks to trainers and heart-rate straps
// through the standard Web Bluetooth API, which WKWebView (iOS/iPadOS) does
// not implement. Instead of forking the app's BLE modules, this shim
// implements the exact API subset those modules use — requestDevice,
// getDevices, gatt.connect/disconnect, getPrimaryService, getCharacteristic,
// startNotifications + "characteristicvaluechanged" (DataView value),
// writeValue / writeValueWithoutResponse, and the "gattserverdisconnected"
// device event — and routes it to the native BLE plugin. The app's own
// `navigator.bluetooth` checks then pass unchanged.
//
// Error shaping matters: trainer.mjs distinguishes "service not found"
// (error.name === "NotFoundError" — how it detects FTMS vs Tacx FE-C) from
// "GATT disconnected" (/disconnected/i on the message — its reconnect-once
// path), so the errors thrown here reproduce both signatures.

import { BleClient, numberToUUID } from "@capacitor-community/bluetooth-le";

// Web Bluetooth's getDevices() returns previously granted devices; the native
// plugin instead resolves known peripheral ids. Remember every device the
// user has ever picked so saved-trainer/strap auto-reconnect keeps working.
// localStorage (not the app's IndexedDB store) keeps this shim self-contained.
const KNOWN_DEVICES_KEY = "gpx-rider:ble-known-devices";

let initialized = false;
const deviceCache = new Map(); // deviceId -> ShimBluetoothDevice

async function ensureInitialized() {
  if (initialized) return;
  await BleClient.initialize({ androidNeverForLocation: true });
  initialized = true;
}

function toUuid(id) {
  return typeof id === "number" ? numberToUUID(id) : String(id).toLowerCase();
}

function toDataView(data) {
  if (data instanceof DataView) return data;
  if (ArrayBuffer.isView(data)) return new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof ArrayBuffer) return new DataView(data);
  throw new TypeError("Expected an ArrayBuffer, TypedArray, or DataView.");
}

function notFoundError(message) {
  const error = new Error(message);
  error.name = "NotFoundError";
  return error;
}

function readKnownDevices() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KNOWN_DEVICES_KEY));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function rememberDevice(deviceId, name) {
  const known = readKnownDevices().filter((entry) => entry.id !== deviceId);
  known.push({ id: deviceId, name: name || "" });
  try {
    localStorage.setItem(KNOWN_DEVICES_KEY, JSON.stringify(known));
  } catch {
    // Best effort — losing this only disables auto-reconnect.
  }
}

function getOrCreateDevice(deviceId, name) {
  let device = deviceCache.get(deviceId);
  if (!device) {
    device = new ShimBluetoothDevice(deviceId, name);
    deviceCache.set(deviceId, device);
  } else if (name && !device.name) {
    device.name = name;
  }
  return device;
}

class ShimBluetoothDevice extends EventTarget {
  constructor(deviceId, name) {
    super();
    this.id = deviceId;
    this.name = name || undefined;
    this.gatt = new ShimGattServer(this);
  }
}

class ShimGattServer {
  constructor(device) {
    this.device = device;
    this.connected = false;
    this._services = null;
  }

  async connect() {
    await ensureInitialized();
    if (this.connected) return this;
    await BleClient.connect(this.device.id, () => {
      this.connected = false;
      this._services = null;
      this.device.dispatchEvent(new Event("gattserverdisconnected"));
    });
    this.connected = true;
    // Discover everything up front so getPrimaryService/getCharacteristic can
    // resolve synchronously against this snapshot, like Chrome's GATT cache.
    this._services = await BleClient.getServices(this.device.id);
    return this;
  }

  disconnect() {
    if (!this.connected) return;
    this.connected = false;
    this._services = null;
    // The plugin fires the onDisconnected callback registered in connect(),
    // which dispatches "gattserverdisconnected" — same as Web Bluetooth.
    BleClient.disconnect(this.device.id).catch(() => {});
  }

  async getPrimaryService(uuid) {
    if (!this.connected) throw new Error("GATT Server is disconnected. Cannot retrieve services.");
    const target = toUuid(uuid);
    const info = (this._services || []).find((service) => service.uuid.toLowerCase() === target);
    if (!info) throw notFoundError(`No Services matching UUID ${target} found in Device.`);
    return new ShimGattService(this, info);
  }
}

class ShimGattService {
  constructor(server, info) {
    this._server = server;
    this.device = server.device;
    this.uuid = info.uuid.toLowerCase();
    this._characteristics = info.characteristics || [];
  }

  async getCharacteristic(uuid) {
    if (!this._server.connected) throw new Error("GATT Server is disconnected. Cannot retrieve characteristics.");
    const target = toUuid(uuid);
    const info = this._characteristics.find((characteristic) => characteristic.uuid.toLowerCase() === target);
    if (!info) throw notFoundError(`No Characteristics matching UUID ${target} found in Service.`);
    return new ShimGattCharacteristic(this, info);
  }
}

class ShimGattCharacteristic extends EventTarget {
  constructor(service, info) {
    super();
    this.service = service;
    this.uuid = info.uuid.toLowerCase();
    this.properties = info.properties || {};
    this.value = null;
  }

  get _deviceId() {
    return this.service.device.id;
  }

  async startNotifications() {
    await BleClient.startNotifications(this._deviceId, this.service.uuid, this.uuid, (value) => {
      this.value = value; // DataView, exactly what Web Bluetooth exposes
      this.dispatchEvent(new Event("characteristicvaluechanged"));
    });
    return this;
  }

  async stopNotifications() {
    await BleClient.stopNotifications(this._deviceId, this.service.uuid, this.uuid);
    return this;
  }

  async readValue() {
    this.value = await BleClient.read(this._deviceId, this.service.uuid, this.uuid);
    this.dispatchEvent(new Event("characteristicvaluechanged"));
    return this.value;
  }

  async writeValue(data) {
    await BleClient.write(this._deviceId, this.service.uuid, this.uuid, toDataView(data));
  }

  async writeValueWithResponse(data) {
    await this.writeValue(data);
  }

  async writeValueWithoutResponse(data) {
    await BleClient.writeWithoutResponse(this._deviceId, this.service.uuid, this.uuid, toDataView(data));
  }
}

async function requestDevice(options = {}) {
  await ensureInitialized();

  // Web Bluetooth ORs its filter clauses; the native plugin ANDs its fields.
  // The closest faithful translation is the union of every service mentioned
  // in any clause: the devices the app also matches by bare namePrefix
  // (KICKR, Tacx) advertise their control service anyway, and a name prefix
  // passed *alongside* services would wrongly AND-restrict the scan.
  const filters = options.filters || [];
  const services = [...new Set(filters.flatMap((filter) => (filter.services || []).map(toUuid)))];
  const namePrefix = filters.find((filter) => filter.namePrefix && !(filter.services || []).length)?.namePrefix;

  const request = { optionalServices: (options.optionalServices || []).map(toUuid) };
  if (services.length) request.services = services;
  else if (namePrefix) request.namePrefix = namePrefix;

  const picked = await BleClient.requestDevice(request); // native device picker
  rememberDevice(picked.deviceId, picked.name);
  return getOrCreateDevice(picked.deviceId, picked.name);
}

async function getDevices() {
  await ensureInitialized();
  const known = readKnownDevices();
  if (!known.length) return [];
  try {
    const devices = await BleClient.getDevices(known.map((entry) => entry.id));
    return devices.map((device) =>
      getOrCreateDevice(device.deviceId, device.name || known.find((entry) => entry.id === device.deviceId)?.name),
    );
  } catch {
    return [];
  }
}

export function installWebBluetoothPolyfill() {
  const bluetooth = {
    requestDevice,
    getDevices,
    getAvailability: async () => true,
  };
  Object.defineProperty(navigator, "bluetooth", { value: bluetooth, configurable: true });
}
