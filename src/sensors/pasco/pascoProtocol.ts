/**
 * Higher-level PASCO protocol helpers: the one-shot read command, and the
 * (best-effort) Motion-sensor channel layout.
 */

import { GCMD_READ_ONE_SAMPLE } from "./pascoBluetoothConstants";
import { channelPacketSize } from "./pascoPacketDecoder";
import type { PascoChannelLayout } from "./pascoTypes";

/**
 * PROVISIONAL Motion-sensor channel layout.
 *
 * The PASCO Wireless Motion Sensor (PS-3219) reports Position (m) and Velocity
 * (m/s) as 4-byte little-endian IEEE-754 floats ("Direct" measurements). The
 * EXACT ordering, ids and any additional channel fields come from the device's
 * embedded XML datasheet, which is not bundled here. This default assumes the
 * common [Position, Velocity] ordering and MUST be confirmed against real
 * hardware using the diagnostic raw-packet log before claiming verified support.
 *
 * See docs/PASCO_MOTION_EXPERIMENT_NOTES.md → "BLE implementation status".
 */
export const MOTION_CHANNEL_LAYOUT: PascoChannelLayout = {
  channelName: "Motion",
  measurements: [
    { name: "Position", dataSize: 4, type: "Direct", unit: "m" },
    { name: "Velocity", dataSize: 4, type: "Direct", unit: "m/s" },
  ],
};

/** Build the one-shot read command bytes: [0x05, packetSize]. */
export function buildReadOneSampleCommand(layout: PascoChannelLayout): Uint8Array {
  return new Uint8Array([GCMD_READ_ONE_SAMPLE, channelPacketSize(layout)]);
}

/** Find a measurement value by case-insensitive name from a decoded list. */
export function pickMeasurement(
  decoded: { name: string; value: number }[],
  name: string,
): number | null {
  const hit = decoded.find((d) => d.name.toLowerCase() === name.toLowerCase());
  return hit ? hit.value : null;
}
