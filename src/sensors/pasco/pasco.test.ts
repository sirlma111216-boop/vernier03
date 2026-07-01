import { describe, expect, it } from "vitest";
import {
  candidateServiceUuids,
  charIdSegment,
  decodePascoBase64,
  parsePascoName,
  pascoUuid,
  RECV_CMD_CHAR_UUID,
  SEND_CMD_CHAR_UUID,
} from "./pascoBluetoothConstants";
import {
  ECHO_TIME_TO_METERS,
  decodeChannelPayload,
  decodeFloat32LE,
  decodeMotionPacket,
  parseNotification,
} from "./pascoPacketDecoder";
import { MOTION_CHANNEL_LAYOUT, buildReadOneSampleCommand } from "./pascoProtocol";
import type { PascoChannelLayout } from "./pascoTypes";

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

describe("service discovery helpers", () => {
  it("pre-authorizes a range of channel service UUIDs (0..N)", () => {
    const uuids = candidateServiceUuids(3);
    expect(uuids).toHaveLength(4);
    expect(uuids[0]).toBe("4a5c0000-0000-0000-0000-5c1e741f1c00");
    expect(uuids[1]).toBe("4a5c0001-0000-0000-0000-5c1e741f1c00"); // sensor channel 1
  });

  it("extracts the char-id segment used to classify send/recv characteristics", () => {
    expect(charIdSegment(SEND_CMD_CHAR_UUID)).toBe("0002");
    expect(charIdSegment(RECV_CMD_CHAR_UUID)).toBe("0003");
    expect(charIdSegment(pascoUuid(1, 2))).toBe("0002");
  });
});

describe("one-shot read command", () => {
  it("builds [0x05, packetSize] from the channel layout", () => {
    const cmd = buildReadOneSampleCommand(MOTION_CHANNEL_LAYOUT);
    expect(cmd[0]).toBe(0x05);
    expect(cmd[1]).toBe(2); // EchoTime is a single 2-byte RawDigital measurement
  });
});

describe("generic channel payload decoding", () => {
  it("decodes an ordered Direct (float) channel payload by measurement spec", () => {
    const layout: PascoChannelLayout = {
      channelName: "Test",
      measurements: [
        { name: "A", dataSize: 4, type: "Direct", unit: "m" },
        { name: "B", dataSize: 4, type: "Direct", unit: "m/s" },
      ],
    };
    const payload = new Uint8Array([...floatLE(0.523), ...floatLE(0.184)]);
    const decoded = decodeChannelPayload(payload, layout);
    expect(decoded[0].value).toBeCloseTo(0.523, 4);
    expect(decoded[1].value).toBeCloseTo(0.184, 4);
  });

  it("decodes raw little-endian float bytes", () => {
    expect(decodeFloat32LE(new Uint8Array(floatLE(1.5)), 0)).toBeCloseTo(1.5, 6);
  });

  it("strips the GRSP header from a one-shot response", () => {
    const packet = new Uint8Array([0xc0, 0x00, 0x05, 0x41, 0x04]);
    const parsed = parseNotification(packet);
    expect(parsed.ok).toBe(true);
    expect(Array.from(parsed.payload!)).toEqual([0x41, 0x04]);
  });
});

describe("EchoTime→Position decode (real PS-3219 packets)", () => {
  it("decodes EchoTime (uint16 LE after GRSP header) into a distance", () => {
    // Real packet: c0 00 05 3f 0a … → EchoTime 0x0a3f = 2623 → ~0.451 m.
    const packet = new Uint8Array([
      0xc0, 0x00, 0x05, 0x3f, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    const d = decodeMotionPacket(packet);
    expect(d).not.toBeNull();
    expect(d!.echoTimeRaw).toBe(2623);
    expect(d!.positionM).toBeCloseTo(2623 * ECHO_TIME_TO_METERS, 6);
    expect(d!.positionM).toBeCloseTo(0.451, 2);
    expect(d!.payloadOffset).toBe(3);
  });

  it("decodes the ~20 cm start reading (echo 1089 → 0.187 m)", () => {
    // Real packet from the moving capture: c0 00 05 41 04 … → 0x0441 = 1089.
    const packet = new Uint8Array([0xc0, 0x00, 0x05, 0x41, 0x04, 0x00, 0x20]);
    const d = decodeMotionPacket(packet);
    expect(d!.echoTimeRaw).toBe(1089);
    expect(d!.positionM).toBeCloseTo(0.187, 2);
  });

  it("does NOT mis-read the GRSP header bytes as a float position", () => {
    // The old float scanner wrongly read c0 00 05 3f ≈ 0.52 m; EchoTime decode
    // skips the 3-byte header and reads the real payload instead.
    const packet = new Uint8Array([
      0xc0, 0x00, 0x05, 0x3f, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    expect(decodeMotionPacket(packet)!.positionM).toBeLessThan(0.5);
  });

  it("rejects an out-of-range echo (implausible distance)", () => {
    // echo 0xFFFF = 65535 → ~11.3 m, beyond the 8.5 m ceiling.
    const packet = new Uint8Array([0xc0, 0x00, 0x05, 0xff, 0xff]);
    expect(decodeMotionPacket(packet)).toBeNull();
  });

  it("reads a raw stream (no GRSP header) from offset 0", () => {
    const packet = new Uint8Array([0x41, 0x04]); // echo 1089
    expect(decodeMotionPacket(packet)!.echoTimeRaw).toBe(1089);
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
