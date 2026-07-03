// BLE heart-rate strap support via the standard Heart Rate service (0x180D).
// Any strap that broadcasts Heart Rate Measurement notifications works —
// Polar, Garmin, Wahoo TICKR, etc.

import { readJson, writeJson } from "./storage.mjs";

const HEART_RATE_SERVICE = 0x180d;
const HEART_RATE_MEASUREMENT = 0x2a37;
const HEART_RATE_STORAGE_KEY = "gpx-rider:last-heart-rate";

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
    callbacks.onMessage(error.message || "Could not connect to the heart rate sensor.");
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
  device.addEventListener("gattserverdisconnected", () => {
    strap.device = null;
    strap.measurement = null;
    callbacks.onHeartRate(null);
    callbacks.onStatus("Disconnected");
  });

  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(HEART_RATE_SERVICE);
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

function handleHeartRateMeasurement(event) {
  const data = event.target.value;
  if (data.byteLength < 2) return;

  // Flags bit 0 selects an 8- or 16-bit heart rate value.
  const flags = data.getUint8(0);
  const bpm = flags & 0x01 ? data.getUint16(1, true) : data.getUint8(1);
  callbacks.onHeartRate(bpm > 0 ? bpm : null);
}
