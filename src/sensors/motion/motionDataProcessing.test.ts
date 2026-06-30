import { describe, expect, it } from "vitest";
import {
  buildMotionSamples,
  detectMotionStartIndex,
  detectsDirectionChange,
  isPlausiblePositionM,
  meterToCm,
  movementDistanceCm,
  mpsToCmps,
  speedFromVelocityMps,
} from "./motionDataProcessing";
import type { RawMotionSample } from "../types";

describe("unit conversions", () => {
  it("converts meters to centimeters", () => {
    expect(meterToCm(0.5)).toBe(50);
    expect(meterToCm(1.23)).toBeCloseTo(123, 6);
  });

  it("converts m/s to cm/s", () => {
    expect(mpsToCmps(0.2)).toBeCloseTo(20, 6);
  });

  it("speed is the non-negative magnitude in cm/s", () => {
    expect(speedFromVelocityMps(-0.3)).toBeCloseTo(30, 6);
    expect(speedFromVelocityMps(0.3)).toBeCloseTo(30, 6);
  });
});

describe("movement-distance normalization", () => {
  it("moving away: (current - initial) * 100", () => {
    expect(movementDistanceCm(0.8, 0.3, "away")).toBeCloseTo(50, 6);
  });

  it("moving toward: (initial - current) * 100", () => {
    expect(movementDistanceCm(0.3, 0.8, "toward")).toBeCloseTo(50, 6);
  });

  it("auto resolves away when resolvedAwayWhenAuto is true", () => {
    expect(movementDistanceCm(0.8, 0.3, "auto", true)).toBeCloseTo(50, 6);
    expect(movementDistanceCm(0.3, 0.8, "auto", false)).toBeCloseTo(50, 6);
  });
});

describe("position validity", () => {
  it("rejects NaN, Infinity and out-of-range positions", () => {
    expect(isPlausiblePositionM(NaN)).toBe(false);
    expect(isPlausiblePositionM(Infinity)).toBe(false);
    expect(isPlausiblePositionM(0.0)).toBe(false);
    expect(isPlausiblePositionM(99)).toBe(false);
    expect(isPlausiblePositionM(0.5)).toBe(true);
  });
});

describe("direction-change detection", () => {
  it("returns false for monotonic forward motion", () => {
    expect(detectsDirectionChange([0, 10, 20, 30, 40])).toBe(false);
  });

  it("returns true when motion reverses beyond noise tolerance", () => {
    expect(detectsDirectionChange([0, 10, 20, 8, 2])).toBe(true);
  });
});

describe("motion-start detection", () => {
  it("ignores a single noisy sample and requires consecutive over-threshold speeds", () => {
    const speeds = [0, 1, 9, 0.5, 0.4, 5, 6, 7, 8];
    // The single spike at index 2 must NOT trigger; sustained motion starts at index 5.
    expect(detectMotionStartIndex(speeds, 4, 3)).toBe(5);
  });

  it("returns -1 when motion never sustains", () => {
    expect(detectMotionStartIndex([0, 1, 0, 1, 0], 4, 3)).toBe(-1);
  });
});

describe("buildMotionSamples", () => {
  const startMs = 1000;
  const raw: RawMotionSample[] = Array.from({ length: 11 }, (_, i) => ({
    timestampMs: startMs + i * 100,
    rawPositionM: 0.3 + i * 0.02, // away from sensor, 2 cm per 0.1 s -> 20 cm/s
    rawVelocityMps: 0.2,
  }));

  it("normalizes movement distance to start at ~0 and derives non-negative speed", () => {
    const built = buildMotionSamples(raw, 0.3, startMs, {
      direction: "away",
      preferSensorVelocity: true,
    });
    expect(built.samples[0].movementDistanceCm).toBeCloseTo(0, 4);
    expect(built.samples[10].movementDistanceCm).toBeCloseTo(20, 1);
    expect(built.samples.every((s) => s.speedCmps >= 0)).toBe(true);
    expect(built.velocitySource).toBe("sensor");
    expect(built.directionChanged).toBe(false);
  });

  it("derives speed from position when sensor velocity is unavailable", () => {
    const noVel = raw.map((r) => ({ ...r, rawVelocityMps: null }));
    const built = buildMotionSamples(noVel, 0.3, startMs, {
      direction: "away",
      preferSensorVelocity: true,
    });
    expect(built.velocitySource).toBe("derived");
    // ~20 cm/s expected from the slope.
    const mid = built.samples[5].speedCmps;
    expect(mid).toBeGreaterThan(15);
    expect(mid).toBeLessThan(25);
  });
});
