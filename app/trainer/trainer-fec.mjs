// Tacx FE-C over BLE trainer backend. The wheel-on Tacx trainers (Flow,
// Vortex, Bushido, Genius) don't expose FTMS; they tunnel ANT+ FE-C over the
// vendor service 6e40fec1. This module owns that BLE connection — telemetry
// notifications and Track Resistance (grade) writes — behind the same telemetry
// / status callbacks trainer.mjs uses for FTMS, so trainer.mjs can pair once
// and route to whichever protocol the chosen device actually speaks.
//
// The wire format (ANT framing + FE-C page encode/decode) lives in the pure,
// tested fec.mjs; this module is only the BLE IO around it: characteristics,
// notification merging, a one-write-at-a-time queue, and adapting to whether a
// given device wraps its pages in ANT framing or sends them bare.

import {
  ANT_ACKNOWLEDGED_DATA,
  ANT_BROADCAST_DATA,
  buildAntFrame,
  decodeFecPage,
  encodeTrackResistancePage,
  FEC_PAGE_GENERAL,
  FEC_PAGE_TRAINER,
  parseAntFrame,
} from "./fec.mjs";
import { TACX_FEC_DEFAULT_CRR } from "../core/tuning.mjs";

export const TACX_FEC_SERVICE = "6e40fec1-b5a3-f393-e0a9-e50e24dcca9e";
const TACX_FEC_NOTIFY = "6e40fec2-b5a3-f393-e0a9-e50e24dcca9e"; // trainer -> app
const TACX_FEC_WRITE = "6e40fec3-b5a3-f393-e0a9-e50e24dcca9e"; // app -> trainer

const fec = {
  notify: null,
  write: null,
  writeQueue: Promise.resolve(),
  gradeWriteInFlight: false,
  lastGradeRaw: null,
  // "raw" until the first parseable notification proves the device wraps its
  // pages in ANT framing; control writes then mirror that framing and channel.
  framing: "raw",
  channel: 0x05,
  displayName: "Connected", // used to restore status text after a BLE error clears
  // Pages 16 and 25 each carry only part of the telemetry, so keep a rolling
  // snapshot and emit the combined value on every notification.
  telemetry: emptyTelemetry(),
};

let callbacks = { onTelemetry: () => {}, onStatus: () => {} };

function emptyTelemetry() {
  return { speedKph: null, powerWatts: null, cadenceRpm: null, heartRateBpm: null };
}

export function isFecConnected() {
  return Boolean(fec.write);
}

// Wire up the Tacx FE-C characteristics on an already-resolved service. The
// caller (trainer.mjs) has done device selection, GATT connect, and service
// detection; this only owns the FE-C-specific plumbing.
export async function connectFec(service, handlers) {
  const { displayName, ...rest } = handlers;
  callbacks = { ...callbacks, ...rest };
  resetFec();
  fec.displayName = displayName || "Connected";

  fec.notify = await service.getCharacteristic(TACX_FEC_NOTIFY);
  fec.write = await service.getCharacteristic(TACX_FEC_WRITE);
  fec.notify.addEventListener("characteristicvaluechanged", handleFecNotification);
  await fec.notify.startNotifications();
}

export function resetFec() {
  fec.notify = null;
  fec.write = null;
  fec.writeQueue = Promise.resolve();
  fec.gradeWriteInFlight = false;
  fec.lastGradeRaw = null;
  fec.framing = "raw";
  fec.telemetry = emptyTelemetry();
}

function handleFecNotification(event) {
  const view = event.target.value;
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);

  // Devices differ on whether they present bare FE-C pages or full ANT frames;
  // learn the framing (and ANT channel) from the first frame that parses.
  let page = bytes;
  const frame = parseAntFrame(bytes);
  if (frame && (frame.msgId === ANT_BROADCAST_DATA || frame.msgId === ANT_ACKNOWLEDGED_DATA)) {
    fec.framing = "ant";
    fec.channel = frame.channel;
    page = frame.data;
  }

  const decoded = decodeFecPage(page);
  if (!decoded) return;

  if (decoded.page === FEC_PAGE_GENERAL) {
    fec.telemetry.speedKph = decoded.speedKph;
    fec.telemetry.heartRateBpm = decoded.heartRateBpm;
  } else if (decoded.page === FEC_PAGE_TRAINER) {
    fec.telemetry.powerWatts = decoded.powerWatts;
    fec.telemetry.cadenceRpm = decoded.cadenceRpm;
  }

  callbacks.onTelemetry({
    speedKph: fec.telemetry.speedKph,
    powerWatts: fec.telemetry.powerWatts,
    cadenceRpm: fec.telemetry.cadenceRpm,
    totalCaloriesKcal: null, // FE-C carries no accumulated calories; the app derives it from power
    heartRateBpm: fec.telemetry.heartRateBpm,
  });
}

// Send a Track Resistance (grade) command. Mirrors the FTMS backend's guards:
// dedupe identical grades and never let a slow write build a backlog. Returns
// true when the trainer is connected and the write was attempted.
export async function sendFecGrade(gradePercent) {
  if (!fec.write) return false;
  if (fec.gradeWriteInFlight) {
    console.debug(`[trainer-fec] grade ${gradePercent.toFixed(1)}% dropped, previous write still in flight`);
    return true;
  }

  const page = encodeTrackResistancePage(gradePercent, { crr: TACX_FEC_DEFAULT_CRR });
  const raw = page[5] | (page[6] << 8);
  if (raw === fec.lastGradeRaw) return true;

  const bytes = fec.framing === "ant"
    ? buildAntFrame(ANT_ACKNOWLEDGED_DATA, fec.channel, page)
    : page;

  console.debug(`[trainer-fec] sending grade ${gradePercent.toFixed(1)}% (page 51 raw ${raw})`);
  fec.gradeWriteInFlight = true;
  try {
    await queueFecWrite(bytes);
    fec.lastGradeRaw = raw;
    callbacks.onStatus(fec.displayName, { onlyClearError: true });
    console.debug(`[trainer-fec] grade ${gradePercent.toFixed(1)}% write acknowledged`);
    return true;
  } catch (error) {
    console.error(`[trainer-fec] grade ${gradePercent.toFixed(1)}% write failed`, error);
    callbacks.onStatus("BLE error");
    return true;
  } finally {
    fec.gradeWriteInFlight = false;
  }
}

function queueFecWrite(bytes) {
  // The device only allows one outstanding GATT operation at a time.
  const task = fec.writeQueue.then(() => writeFecBytes(bytes));
  fec.writeQueue = task.catch(() => {});
  return task;
}

async function writeFecBytes(bytes) {
  const payload = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  // FE-C control is an acknowledged transaction; prefer a Write Request and
  // only fall back to Write Without Response for peripherals that reject it.
  try {
    await fec.write.writeValue(payload);
  } catch {
    await fec.write.writeValueWithoutResponse(payload);
  }
}
