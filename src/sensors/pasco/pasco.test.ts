import { describe, expect, it } from "vitest";
import {
  decodePascoBase64,
  parsePascoName,
  pascoUuid,
  RECV_CMD_CHAR_UUID,
  SEND_CMD_CHAR_UUID,
} from "./pascoBluetoothConstants";
import {
  decodeChannelPayload,
  decodeFloat32LE,
  parseNotification,
} from "./pascoPacketDecoder";
import {
  MOTION_CHANNEL_LAYOUT,
  buildReadOneSampleCommand,
  pickMeasurement,
} from "./pascoProtocol";

// Helper: build a 4-byte LE float buffer.
function floatLE(value: number): number[] {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setFloat32(0, value, true);
  return Array.from(new Uint8Array(buf));
}

describe("PASCO UUID construction", () => {
  it("follows the official 4a5c000{service}-000{char}-…-5c1e741f1c00 pattern", () => {
    expect(pascoUuid(0, 0)).toBe("4a5c0000-0000-0000-0000-5c1e741f1c00");
    expect(pascoUuid(0, 2)).toBe("4a5c0000-0002-0000-0000-5c1e741f1c00");
    expect(SEND_CMD_CHAR_UUID).toBe("4a5c0000-0002-0000-0000-5c1e741f1c00");
    expect(RECV_CMD_CHAR_UUID).toBe("4a5c0000-0003-0000-0000-5c1e741f1c00");
  });
});

describe("PASCO device-name parsing", () => {
  it("splits device type, 7-char serial id, and interface id", () => {
    // Official parsing reads the serial from token[0:7] and the interface char
    // from token[8] (the 9th char), so the trailing token is >= 9 chars.
    const parsed = parsePascoName("Motion 1234567-K");
    expect(parsed.deviceType).toBe("Motion");
    expect(parsed.serialId).toBe("1234567");
    // 9th char 'K' -> base64 map; interfaceId = decoded + 1024
    expect(parsed.interfaceId).toBe(decodePascoBase64("K")! + 1024);
  });

  it("handles multi-word device types via rsplit semantics", () => {
    const parsed = parsePascoName("Force Accel 7654321A");
    expect(parsed.deviceType).toBe("Force Accel");
    expect(parsed.serialId).toBe("7654321");
  });

  it("decodes the base64 char map for digits and letters", () => {
    expect(decodePascoBase64("0")).toBe(0);
    expect(decodePascoBase64("9")).toBe(9);
    expect(decodePascoBase64("A")).toBe(10);
    expect(decodePascoBase64("?")).toBeNull();
  });
});

describe("one-shot read command", () => {
  it("builds [0x05, packetSize] from the channel layout", () => {
    const cmd = buildReadOneSampleCommand(MOTION_CHANNEL_LAYOUT);
    expect(cmd[0]).toBe(0x05);
    expect(cmd[1]).toBe(8); // Position(4) + Velocity(4)
  });
});

describe("valid position/velocity packet decoding", () => {
  it("decodes a GRSP_RESULT one-shot response into position and velocity", () => {
    const positionM = 0.523;
    const velocityMps = 0.184;
    const payload = [...floatLE(positionM), ...floatLE(velocityMps)];
    const packet = new Uint8Array([0xc0, 0x00, 0x05, ...payload]);

    const parsed = parseNotification(packet);
    expect(parsed.ok).toBe(true);
    expect(parsed.payload).not.toBeNull();

    const decoded = decodeChannelPayload(parsed.payload!, MOTION_CHANNEL_LAYOUT);
    expect(pickMeasurement(decoded, "Position")).toBeCloseTo(positionM, 4);
    expect(pickMeasurement(decoded, "Velocity")).toBeCloseTo(velocityMps, 4);
  });

  it("decodes raw little-endian float bytes", () => {
    expect(decodeFloat32LE(new Uint8Array(floatLE(1.5)), 0)).toBeCloseTo(1.5, 6);
  });
});

describe("invalid packet rejection", () => {
  it("returns no payload for an error response (status != 0)", () => {
    const packet = new Uint8Array([0xc0, 0x01, 0x05, 0, 0, 0, 0]);
    const parsed = parseNotification(packet);
    expect(parsed.ok).toBe(false);
    expect(parsed.payload).toBeNull();
  });

  it("treats markers <= 0x1F as periodic, not one-shot results", () => {
    const packet = new Uint8Array([0x01, 0xaa, 0xbb]);
    const parsed = parseNotification(packet);
    expect(parsed.isPeriodic).toBe(true);
    expect(parsed.payload).not.toBeNull();
  });

  it("handles an empty packet without throwing", () => {
    const parsed = parseNotification(new Uint8Array([]));
    expect(parsed.payload).toBeNull();
  });
});
