// BLE heart-rate strap support via the standard Heart Rate service (0x180D).
// Any strap that broadcasts Heart Rate Measurement notifications works —
// Polar, Garmin, Wahoo TICKR, etc.

import { readJson, writeJson } from "./storage.mjs";

const HEART_RATE_SERVICE = 0x180d;
const HEART_RATE_MEASUREMENT = 0x2a37;
const HEART_RATE_STORAGE_KEY = "gpx-rider:last-heart-rate";
const GATT_RECONNECT_DELAY_MS = 350;

const strap = {
  device: null,
  measurement: null,
};

let callbacks = {
  onHeartRate: () => {},
  onStatus: () => {},
  onMessage: () => {},
};

export function initHeartRate(handlers) {
  callbacks = { ...callbacks, ...handlers };
}

export function isHeartRateConnected() {
  return Boolean(strap.measurement);
}

export async function connectHeartRate() {
  if (!navigator.bluetooth) {
    callbacks.onStatus("Use Chrome");
    callbacks.onMessage("Web Bluetooth is available in Chrome or Edge, not Safari.");
    return;
  }

  try {
    callbacks.onStatus("Pairing");
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [HEART_RATE_SERVICE] }],
    });

    await connectHeartRateDevice(device);
  } catch (error) {
    console.error(error);
    callbacks.onStatus("Failed");
    callbacks.onMessage(connectionErrorMessage(error, "heart rate sensor"));
  }
}

export async function reconnectSavedHeartRate() {
  const saved = readJson(HEART_RATE_STORAGE_KEY);
  if (!saved || !navigator.bluetooth?.getDevices) return;

  try {
    const devices = await navigator.bluetooth.getDevices();
    const device = devices.find((candidate) => candidate.id === saved.id || candidate.name === saved.name);
    if (!device) return;

    callbacks.onStatus("Reconnecting");
    await connectHeartRateDevice(device);
  } catch (error) {
    console.warn("Could not reconnect saved heart rate sensor.", error);
    callbacks.onStatus(saved.name || "Saved");
  }
}

async function connectHeartRateDevice(device) {
  strap.device = null;
  strap.measurement = null;
  device.addEventListener("gattserverdisconnected", () => {
    strap.device = null;
    strap.measurement = null;
    callbacks.onHeartRate(null);
    callbacks.onStatus("Disconnected");
  });

  const service = await getPrimaryServiceWithRetry(device, HEART_RATE_SERVICE, "heart rate sensor");
  strap.measurement = await service.getCharacteristic(HEART_RATE_MEASUREMENT);
  strap.measurement.addEventListener("characteristicvaluechanged", handleHeartRateMeasurement);
  await strap.measurement.startNotifications();

  strap.device = device;
  writeJson(HEART_RATE_STORAGE_KEY, {
    id: device.id,
    name: device.name || "HR sensor",
    savedAt: new Date().toISOString(),
  });
  callbacks.onStatus(device.name || "Connected");
}

async function getPrimaryServiceWithRetry(device, serviceUuid, label) {
  try {
    const server = await connectGatt(device);
    return await server.getPrimaryService(serviceUuid);
  } catch (error) {
    if (!isGattDisconnectedError(error)) throw error;

    console.warn(`GATT disconnected while discovering ${label}; reconnecting once.`, error);
    callbacks.onStatus("Reconnecting");
    try {
      device.gatt?.disconnect?.();
    } catch {
      // Some browsers throw if already disconnected; connecting below is enough.
    }
    await delay(GATT_RECONNECT_DELAY_MS);
    const server = await connectGatt(device);
    return await server.getPrimaryService(serviceUuid);
  }
}

async function connectGatt(device) {
  if (!device.gatt) throw new Error("This Bluetooth device does not expose a GATT server.");
  if (device.gatt.connected) return device.gatt;
  return device.gatt.connect();
}

function isGattDisconnectedError(error) {
  return /GATT Server is disconnected|Cannot retrieve services|disconnected/i.test(error?.message || "");
}

function connectionErrorMessage(error, label) {
  if (isGattDisconnectedError(error)) {
    return `Could not keep the ${label} connected. Turn it awake, keep it nearby, then connect again.`;
  }
  return error?.message || `Could not connect to the ${label}.`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function handleHeartRateMeasurement(event) {
  const data = event.target.value;
  if (data.byteLength < 2) return;

  // Flags bit 0 selects an 8- or 16-bit heart rate value.
  const flags = data.getUint8(0);
  const bpm = flags & 0x01 ? data.getUint16(1, true) : data.getUint8(1);
  callbacks.onHeartRate(bpm > 0 ? bpm : null);
}
