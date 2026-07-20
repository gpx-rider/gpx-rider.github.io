// FTMS smart-trainer connection over Web Bluetooth: pairing, saved-device
// reconnect, control-point commands, grade (Set Simulation Parameters)
// writes, and Indoor Bike Data telemetry parsing.

import { clamp } from "../core/geo.mjs";
import { readJson, writeJson } from "../storage/storage.mjs";
import { GRADE_INTERVAL_MAX_SECONDS, GRADE_INTERVAL_MIN_SECONDS } from "../core/tuning.mjs";
import { connectFec, isFecConnected, resetFec, sendFecGrade, TACX_FEC_SERVICE } from "./trainer-fec.mjs";

const FTMS_SERVICE = 0x1826;
const FTMS_INDOOR_BIKE_DATA = 0x2ad2;
const FTMS_CONTROL_POINT = 0x2ad9;
const FTMS_STATUS = 0x2ada;
const GATT_RECONNECT_DELAY_MS = 350;

export const OP_REQUEST_CONTROL = 0x00;
export const OP_RESET = 0x01;
export const OP_START_OR_RESUME = 0x07;
export const OP_STOP_OR_PAUSE = 0x08;
export const OP_SET_SIMULATION = 0x11;

const FTMS_RESPONSE_CODE = 0x80;
const FTMS_RESULT_TEXT = {
  0x01: "Success",
  0x02: "Op code not supported",
  0x03: "Invalid parameter",
  0x04: "Operation failed",
  0x05: "Control not permitted",
};
const FTMS_OPCODE_NAMES = {
  [OP_REQUEST_CONTROL]: "Request Control",
  [OP_RESET]: "Reset",
  [OP_START_OR_RESUME]: "Start/Resume",
  [OP_STOP_OR_PAUSE]: "Stop/Pause",
  [OP_SET_SIMULATION]: "Set Simulation",
};

const TRAINER_STORAGE_KEY = "gpx-rider:last-trainer";

const trainer = {
  device: null,
  protocol: null, // "ftms" | "fec" — which backend owns the connected device
  controlPoint: null,
  bikeData: null,
  writeQueue: Promise.resolve(),
  gradeSampleSum: 0,
  gradeSampleCount: 0,
  lastGradeAttemptAt: 0,
  lastGradeSentRaw: null,
  gradeWriteInFlight: false,
};

let callbacks = {
  onTelemetry: () => {},
  onStatus: () => {},
  onMessage: () => {},
};

export function initTrainer(handlers) {
  callbacks = { ...callbacks, ...handlers };
}

export function trainerDisplayName() {
  return trainer.device?.name || "Connected";
}

export function isTrainerConnected() {
  return Boolean(trainer.controlPoint) || isFecConnected();
}

export async function connectTrainer() {
  if (!navigator.bluetooth) {
    callbacks.onStatus("Use Chrome");
    callbacks.onMessage("Web Bluetooth is available in Chrome or Edge, not Safari.");
    return;
  }

  try {
    callbacks.onStatus("Pairing");
    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { services: [FTMS_SERVICE] },
        { services: [TACX_FEC_SERVICE] },
        { namePrefix: "KICKR" },
        { namePrefix: "Tacx" },
      ],
      optionalServices: [FTMS_SERVICE, TACX_FEC_SERVICE],
    });

    await connectTrainerDevice(device);
  } catch (error) {
    console.error(error);
    callbacks.onStatus("Failed");
    callbacks.onMessage(connectionErrorMessage(error, "trainer"));
  }
}

export async function reconnectSavedTrainer() {
  const savedTrainer = readJson(TRAINER_STORAGE_KEY);
  if (!savedTrainer || !navigator.bluetooth?.getDevices) return;

  try {
    callbacks.onStatus("Reconnecting");
    const devices = await navigator.bluetooth.getDevices();
    const device = devices.find((candidate) => (
      candidate.id === savedTrainer.id ||
      candidate.name === savedTrainer.name ||
      candidate.name?.startsWith("KICKR")
    ));

    if (!device) {
      callbacks.onStatus(savedTrainer.name || "Saved");
      return;
    }

    await connectTrainerDevice(device);
  } catch (error) {
    console.warn("Could not reconnect saved trainer.", error);
    callbacks.onStatus(savedTrainer.name || "Saved");
  }
}

async function connectTrainerDevice(device) {
  resetTrainerConnection();
  device.addEventListener("gattserverdisconnected", handleTrainerDisconnected);

  // FTMS first (KICKR and other standards-compliant trainers); fall back to
  // Tacx FE-C for the wheel-on Tacx units that never got FTMS firmware. The
  // paired device exposes exactly one of the two control protocols.
  const ftmsService = await getPrimaryServiceWithRetry(device, FTMS_SERVICE, "trainer", { optional: true });
  if (ftmsService) {
    await connectFtms(ftmsService);
    trainer.protocol = "ftms";
  } else {
    const fecService = await getPrimaryServiceWithRetry(device, TACX_FEC_SERVICE, "trainer", { optional: true });
    if (!fecService) {
      throw new Error("This trainer exposes neither FTMS nor Tacx FE-C over Bluetooth.");
    }
    await connectFec(fecService, {
      onTelemetry: callbacks.onTelemetry,
      onStatus: callbacks.onStatus,
      displayName: device.name || "Tacx",
    });
    trainer.protocol = "fec";
  }

  trainer.device = device;
  writeJson(TRAINER_STORAGE_KEY, {
    id: device.id,
    name: device.name || (trainer.protocol === "fec" ? "Tacx" : "KICKR"),
    savedAt: new Date().toISOString(),
  });

  if (trainer.protocol === "ftms") {
    await sendTrainerCommand(OP_REQUEST_CONTROL);

    // Clears any stale ERG/resistance target left over from a previous
    // session (Zwift, TrainerRoad, etc.) — some trainers keep enforcing that
    // target and silently ignore Set Simulation Parameters until reset.
    await sendTrainerCommand(OP_RESET);
  }
  // FE-C trainers accept Track Resistance directly — no control handshake.

  callbacks.onStatus(device.name || "Connected");
}

async function connectFtms(service) {
  trainer.controlPoint = await service.getCharacteristic(FTMS_CONTROL_POINT);
  await subscribeToControlPointResponses();
  await subscribeToBikeData(service);

  try {
    const status = await service.getCharacteristic(FTMS_STATUS);
    await status.startNotifications();
  } catch {
    // Some trainers expose indications only on the control point.
  }
}

function resetTrainerConnection() {
  trainer.device = null;
  trainer.protocol = null;
  trainer.controlPoint = null;
  trainer.bikeData = null;
  trainer.writeQueue = Promise.resolve();
  resetFec();
}

function handleTrainerDisconnected() {
  resetTrainerConnection();
  callbacks.onTelemetry(null);
  callbacks.onStatus("Disconnected");
}

async function getPrimaryServiceWithRetry(device, serviceUuid, label, { optional = false } = {}) {
  try {
    const server = await connectGatt(device);
    return await server.getPrimaryService(serviceUuid);
  } catch (error) {
    // An absent optional service is a normal detection outcome, not a failure.
    if (optional && isServiceNotFoundError(error)) return null;
    if (!isGattDisconnectedError(error)) throw error;

    console.warn(`GATT disconnected while discovering ${label}; reconnecting once.`, error);
    callbacks.onStatus("Reconnecting");
    try {
      device.gatt?.disconnect?.();
    } catch {
      // Some browsers throw if already disconnected; connecting below is enough.
    }
    await delay(GATT_RECONNECT_DELAY_MS);
    try {
      const server = await connectGatt(device);
      return await server.getPrimaryService(serviceUuid);
    } catch (retryError) {
      if (optional && isServiceNotFoundError(retryError)) return null;
      throw retryError;
    }
  }
}

function isServiceNotFoundError(error) {
  return error?.name === "NotFoundError" || /No Services matching|not found/i.test(error?.message || "");
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

async function subscribeToControlPointResponses() {
  try {
    trainer.controlPoint.addEventListener("characteristicvaluechanged", handleControlPointResponse);
    await trainer.controlPoint.startNotifications();
  } catch (error) {
    console.warn("Control point responses are not available.", error);
  }
}

function handleControlPointResponse(event) {
  const data = event.target.value;
  if (data.byteLength < 3 || data.getUint8(0) !== FTMS_RESPONSE_CODE) return;

  const requestOpcode = data.getUint8(1);
  const resultCode = data.getUint8(2);
  const resultText = FTMS_RESULT_TEXT[resultCode] || `Error ${resultCode}`;
  const opcodeName = FTMS_OPCODE_NAMES[requestOpcode] || `0x${requestOpcode.toString(16)}`;

  console.debug(`[trainer] response: ${opcodeName} -> ${resultText}`);

  if (resultCode !== 0x01) {
    callbacks.onStatus(resultText);
  }
}

async function subscribeToBikeData(service) {
  try {
    trainer.bikeData = await service.getCharacteristic(FTMS_INDOOR_BIKE_DATA);
    trainer.bikeData.addEventListener("characteristicvaluechanged", handleBikeData);
    await trainer.bikeData.startNotifications();
  } catch (error) {
    console.warn("Indoor Bike Data notifications are not available.", error);
  }
}

function handleBikeData(event) {
  const data = event.target.value;
  const flags = data.getUint16(0, true);
  let index = 2;
  const telemetry = {
    speedKph: null,
    powerWatts: null,
    cadenceRpm: null,
    totalCaloriesKcal: null,
    heartRateBpm: null,
  };

  // FTMS Indoor Bike Data flag bits, in field order. Bit 0 is "More Data":
  // when it is CLEAR the instantaneous speed field is present.
  if ((flags & 0x0001) === 0 && index + 2 <= data.byteLength) {
    telemetry.speedKph = data.getUint16(index, true) / 100;
    index += 2;
  }

  if (flags & 0x0002) index += 2; // average speed

  if ((flags & 0x0004) && index + 2 <= data.byteLength) {
    // Instantaneous cadence: uint16 in units of 0.5 rpm.
    telemetry.cadenceRpm = data.getUint16(index, true) / 2;
    index += 2;
  }
  if (flags & 0x0008) index += 2; // average cadence
  if (flags & 0x0010) index += 3; // total distance (uint24)
  if (flags & 0x0020) index += 2; // resistance level

  if ((flags & 0x0040) && index + 2 <= data.byteLength) {
    telemetry.powerWatts = data.getInt16(index, true);
    index += 2;
  }

  if (flags & 0x0080) index += 2; // average power

  if (flags & 0x0100) {
    // Expended energy: total (uint16 kcal), per hour (uint16), per minute (uint8).
    if (index + 2 <= data.byteLength) {
      const totalKcal = data.getUint16(index, true);
      if (totalKcal !== 0xffff) telemetry.totalCaloriesKcal = totalKcal;
    }
    index += 5;
  }

  if ((flags & 0x0200) && index + 1 <= data.byteLength) {
    const bpm = data.getUint8(index);
    if (bpm > 0) telemetry.heartRateBpm = bpm;
    index += 1;
  }

  callbacks.onTelemetry(telemetry);
}

// Averages every grade sample seen since the last send instead of firing the
// instantaneous value: smooths out point-to-point jitter (2.9/3.0/2.9) and,
// combined with the hard interval, guarantees we never enqueue BLE writes
// faster than the trainer can actually process them.
export function queueTrainerGradeSample(gradePercent, { force = false, intervalSeconds = 2 } = {}) {
  trainer.gradeSampleSum += gradePercent;
  trainer.gradeSampleCount += 1;

  const now = performance.now();
  const intervalMs = clamp(intervalSeconds, GRADE_INTERVAL_MIN_SECONDS, GRADE_INTERVAL_MAX_SECONDS) * 1000;
  const dueForSend = force || trainer.lastGradeAttemptAt === 0 || now - trainer.lastGradeAttemptAt >= intervalMs;
  if (!dueForSend) return;

  const averageGrade = trainer.gradeSampleSum / trainer.gradeSampleCount;
  trainer.gradeSampleSum = 0;
  trainer.gradeSampleCount = 0;
  trainer.lastGradeAttemptAt = now;

  void sendTrainerGrade(averageGrade);
}

export async function sendTrainerGrade(gradePercent) {
  // Tacx FE-C trainers take the grade as a Track Resistance page instead of an
  // FTMS Set Simulation write; the FE-C backend owns its own dedupe/queue.
  if (trainer.protocol === "fec") {
    await sendFecGrade(gradePercent);
    return;
  }
  if (!trainer.controlPoint) return;

  // Never let a slow write build a backlog: if one is still in flight, skip
  // this attempt entirely rather than queueing another. The next window
  // picks up wherever the rider actually is by then.
  if (trainer.gradeWriteInFlight) {
    console.debug(`[trainer] grade ${gradePercent.toFixed(1)}% dropped, previous write still in flight`);
    return;
  }

  const grade = Math.round(gradePercent * 100);
  if (grade === trainer.lastGradeSentRaw) return;

  const payload = [
    OP_SET_SIMULATION,
    0x00, 0x00,
    grade & 0xff, (grade >> 8) & 0xff,
    0x40,
    0x51,
  ];

  console.debug(`[trainer] sending grade ${gradePercent.toFixed(1)}% (raw int16 ${grade})`);
  trainer.gradeWriteInFlight = true;

  try {
    await sendBytes(payload);
    trainer.lastGradeSentRaw = grade;
    clearTrainerErrorStatus();
    console.debug(`[trainer] grade ${gradePercent.toFixed(1)}% write acknowledged`);
  } catch (error) {
    console.error(`[trainer] grade ${gradePercent.toFixed(1)}% write failed`, error);
    callbacks.onStatus("BLE error");
  } finally {
    trainer.gradeWriteInFlight = false;
  }
}

export async function sendTrainerCommand(opcode, payload = []) {
  if (!trainer.controlPoint) return;
  const opcodeName = FTMS_OPCODE_NAMES[opcode] || `0x${opcode.toString(16)}`;
  console.debug(`[trainer] sending command ${opcodeName}`);
  try {
    await sendBytes([opcode, ...payload]);
    clearTrainerErrorStatus();
    console.debug(`[trainer] command ${opcodeName} acknowledged`);
  } catch (error) {
    console.error(`[trainer] command ${opcodeName} failed`, error);
    callbacks.onStatus("BLE error");
  }
}

function clearTrainerErrorStatus() {
  callbacks.onStatus(trainerDisplayName(), { onlyClearError: true });
}

function sendBytes(bytes) {
  // The device only allows one outstanding GATT operation at a time.
  // Grade writes fire independently of Start/Pause/Reset commands, so
  // without a queue two overlapping writes throw "GATT operation already
  // in progress" and the losing write is simply never applied.
  const task = trainer.writeQueue.then(() => writeBytesNow(bytes));
  trainer.writeQueue = task.catch(() => {});
  return task;
}

async function writeBytesNow(bytes) {
  // FTMS requires the Control Point to be written with a Write Request
  // (writeValue) so the machine treats it as a real control transaction and
  // sends back a Response Code indication. Write Without Response is a
  // fire-and-forget command some machines silently accept without ever
  // applying it. Only fall back to it for non-compliant peripherals that
  // don't support Write Request at all.
  try {
    await trainer.controlPoint.writeValue(new Uint8Array(bytes));
  } catch {
    await trainer.controlPoint.writeValueWithoutResponse(new Uint8Array(bytes));
  }
}
