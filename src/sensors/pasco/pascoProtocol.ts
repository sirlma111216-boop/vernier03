/**
 * Higher-level PASCO protocol helpers: the one-shot read command and the
 * Motion-sensor channel layout — now grounded in the OFFICIAL PASCO datasheet.
 *
 * MotionSensor datasheet (Tag="MotionSensor", ID=1130; PS-2103A / wireless PS-3219),
 * from PASCOscientific/pasco_python src/pasco/datasheets.py:
 *   ID=0 EchoTime     Type=RawDigital DataSize=2  (Internal — the only streamed value)
 *   ID=1 Position     Type=USoundPos  Params=344  (host-computed from EchoTime)
 *   ID=2 Velocity     Type=Derivative Inputs=1     (host-computed from Position)
 *   ID=3 Acceleration Type=Derivative              (not used in this experiment)
 *
 * => The sensor sends a 2-byte EchoTime (round-trip time). Position and Velocity
 *    are NOT in the packet; the host computes them. See pascoPacketDecoder.
 */

import { GCMD_READ_ONE_SAMPLE } from "./pascoBluetoothConstants";
import { channelPacketSize } from "./pascoPacketDecoder";
import type { PascoChannelLayout } from "./pascoTypes";

/**
 * Wire layout of a Motion one-shot sample: a single 2-byte RawDigital EchoTime.
 * (Position/Velocity are derived on the host, so they are NOT in the packet.)
 */
export const MOTION_CHANNEL_LAYOUT: PascoChannelLayout = {
  channelName: "Motion",
  measurements: [{ name: "EchoTime", dataSize: 2, type: "RawDigital", unit: "s" }],
};

/** Student-facing measurements this experiment derives from EchoTime. */
export const MOTION_DERIVED_MEASUREMENTS = ["Position", "Velocity"];

/** Build the one-shot read command bytes: [0x05, packetSize]. */
export function buildReadOneSampleCommand(layout: PascoChannelLayout): Uint8Array {
  return new Uint8Array([GCMD_READ_ONE_SAMPLE, channelPacketSize(layout)]);
}
