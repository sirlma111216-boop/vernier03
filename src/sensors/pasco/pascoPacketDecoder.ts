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

export interface ScannedMotion {
  /** Plausible position in meters. */
  positionM: number;
  /** Byte offset within the raw packet where the position float was found. */
  positionOffset: number;
  /** Best-effort velocity candidate (m/s) from the next 4 bytes, for diagnostics. */
  velocityCandidateMps: number | null;
}

/**
 * Layout-robust extraction of a plausible position from a raw PASCO notification.
 *
 * The exact PS-3219 channel byte-layout is not yet hardware-confirmed (see
 * docs/PASCO_MOTION_EXPERIMENT_NOTES.md §4), and the device may reply with a
 * one-shot GRSP_RESULT packet (payload at byte 3) or stream periodic packets
 * (payload at byte 1) — possibly with extra channels such as acceleration.
 *
 * Rather than assume a fixed offset, we scan every byte offset for the first
 * IEEE-754 little-endian float that falls in the physically-plausible position
 * range (m). At rest, velocity and acceleration are ~0 (outside the range), so
 * the position field is selected reliably. The raw bytes are always preserved
 * in diagnostics so the true layout can be confirmed later.
 */
export function scanMotionFromRaw(
  data: Uint8Array,
  opts: { minPosM?: number; maxPosM?: number; maxVelMps?: number } = {},
): ScannedMotion | null {
  const minPos = opts.minPosM ?? 0.15;
  const maxPos = opts.maxPosM ?? 5.0;
  const maxVel = opts.maxVelMps ?? 15;
  for (let off = 0; off + 4 <= data.length; off++) {
    const v = decodeFloat32LE(data, off);
    if (Number.isFinite(v) && v >= minPos && v <= maxPos) {
      let velocityCandidateMps: number | null = null;
      if (off + 8 <= data.length) {
        const vv = decodeFloat32LE(data, off + 4);
        if (Number.isFinite(vv) && Math.abs(vv) <= maxVel) velocityCandidateMps = vv;
      }
      return { positionM: v, positionOffset: off, velocityCandidateMps };
    }
  }
  return null;
}
