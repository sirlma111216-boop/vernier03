/**
 * PASCO packet decoding. Mirrors the decode rules in the official
 * pasco_ble_device.py: 4-byte little-endian IEEE-754 floats for "Direct"
 * measurements, multi-byte little-endian integers for "RawDigital".
 */

import {
  GCMD_READ_ONE_SAMPLE,
  GRSP_OK,
  GRSP_RESULT,
  PERIODIC_PACKET_MAX_MARKER,
} from "./pascoBluetoothConstants";
import type {
  DecodedMeasurement,
  PascoChannelLayout,
  PascoMeasurementSpec,
} from "./pascoTypes";

export function bytesToHex(bytes: Uint8Array | number[]): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
}

/** IEEE-754 32-bit float from 4 little-endian bytes. */
export function decodeFloat32LE(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) return NaN;
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
  return view.getFloat32(0, true);
}

/** Multi-byte little-endian unsigned integer. */
export function decodeUintLE(bytes: Uint8Array, offset: number, size: number): number {
  let value = 0;
  for (let d = 0; d < size; d++) {
    value += (bytes[offset + d] ?? 0) * 2 ** (8 * d);
  }
  return value;
}

export interface ParsedResponse {
  /** Payload of a one-shot read response, or null if this is not such a packet. */
  payload: Uint8Array | null;
  /** True if this is a periodic streaming data packet (marker <= 0x1F). */
  isPeriodic: boolean;
  /** Raw error/marker info for diagnostics. */
  marker: number;
  ok: boolean;
}

/**
 * Interpret a raw notification from the RECV characteristic.
 *  - GRSP_RESULT (0xC0): data[1]=status, data[2]=echoed command, data[3:]=payload
 *  - marker <= 0x1F: periodic streaming packet, data[1:]=payload chunk
 */
export function parseNotification(data: Uint8Array): ParsedResponse {
  if (data.length === 0) {
    return { payload: null, isPeriodic: false, marker: -1, ok: false };
  }
  const marker = data[0];
  if (marker === GRSP_RESULT) {
    const status = data[1];
    const command = data[2];
    const ok = status === GRSP_OK;
    const payload =
      ok && command === GCMD_READ_ONE_SAMPLE ? data.slice(3) : null;
    return { payload, isPeriodic: false, marker, ok };
  }
  if (marker <= PERIODIC_PACKET_MAX_MARKER) {
    return { payload: data.slice(1), isPeriodic: true, marker, ok: true };
  }
  return { payload: null, isPeriodic: false, marker, ok: false };
}

/** Total byte size of a channel payload (used as the one-shot packet size). */
export function channelPacketSize(layout: PascoChannelLayout): number {
  return layout.measurements.reduce((sum, m) => sum + m.dataSize, 0);
}

/** Decode an ordered channel payload into named measurements. */
export function decodeChannelPayload(
  payload: Uint8Array,
  layout: PascoChannelLayout,
): DecodedMeasurement[] {
  const out: DecodedMeasurement[] = [];
  let offset = 0;
  for (const spec of layout.measurements) {
    out.push({
      name: spec.name,
      value: decodeMeasurement(payload, offset, spec),
      unit: spec.unit,
    });
    offset += spec.dataSize;
  }
  return out;
}

export function decodeMeasurement(
  payload: Uint8Array,
  offset: number,
  spec: PascoMeasurementSpec,
): number {
  if (spec.type === "Direct" && spec.dataSize === 4) {
    return decodeFloat32LE(payload, offset);
  }
  return decodeUintLE(payload, offset, spec.dataSize);
}

/**
 * EchoTime→Position conversion.
 *
 * The Motion sensor streams EchoTime as a 2-byte integer: the ultrasonic
 * round-trip time in microseconds. Distance to the object is:
 *   Position(m) = speedOfSound(344 m/s) × (echo_µs × 1e-6 s) / 2
 *              = echo × 344 / 2 × 1e-6 = echo × 1.72e-4
 * (÷2 because the pulse travels to the object AND back.)
 *
 * Confirmed against real PS-3219 packets: echo 1089 → 0.187 m (~20 cm start),
 * echo 2623 → 0.451 m. Speed of sound comes from the datasheet Params="344".
 */
export const SPEED_OF_SOUND_MPS = 344;
export const ECHO_TIME_TO_METERS = (SPEED_OF_SOUND_MPS / 2) * 1e-6;

export interface DecodedMotion {
  /** Raw EchoTime value (round-trip microseconds). */
  echoTimeRaw: number;
  /** Distance from sensor to object, in meters. */
  positionM: number;
  /** Byte offset of the EchoTime field within the raw packet. */
  payloadOffset: number;
}

/**
 * Decode a Motion one-shot notification into EchoTime + Position.
 *
 * Packet shape (observed on real PS-3219): GRSP_RESULT `c0 00 <cmd> <echoLo echoHi> …`
 * — EchoTime is the first payload value (uint16 little-endian) after the 3-byte
 * header. A raw stream without the 0xC0 header is read from offset 0.
 * Returns null if the resulting position is outside the plausible range.
 */
export function decodeMotionPacket(
  data: Uint8Array,
  opts: { minPosM?: number; maxPosM?: number } = {},
): DecodedMotion | null {
  const minPos = opts.minPosM ?? 0.05;
  const maxPos = opts.maxPosM ?? 8.5;
  const start = data.length >= 5 && data[0] === GRSP_RESULT && data[1] === 0x00 ? 3 : 0;
  if (start + 2 > data.length) return null;
  const echoTimeRaw = data[start] | (data[start + 1] << 8); // uint16 LE
  const positionM = echoTimeRaw * ECHO_TIME_TO_METERS;
  if (!Number.isFinite(positionM) || positionM < minPos || positionM > maxPos) {
    return null;
  }
  return { echoTimeRaw, positionM, payloadOffset: start };
}
