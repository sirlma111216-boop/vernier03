import { describe, expect, it } from "vitest";
import {
  analyzeMotion,
  buildIntervalTable,
  buildTimeDistanceTable,
  compareTrials,
  distanceAtTime,
  linearRegression,
  speedStatistics,
} from "./motionAnalysis";
import type { MotionSample } from "../types";

function makeSamples(speedCmps: number, durationS = 5, hz = 10): MotionSample[] {
  const out: MotionSample[] = [];
  const n = durationS * hz;
  for (let i = 0; i <= n; i++) {
    const t = i / hz;
    out.push({
      timestampMs: t * 1000,
      elapsedTimeS: t,
      rawPositionM: 0.3 + (speedCmps * t) / 100,
      rawVelocityMps: speedCmps / 100,
      movementDistanceCm: speedCmps * t,
      speedCmps,
      positionValid: true,
      velocitySource: "sensor",
    });
  }
  return out;
}

describe("linear regression slope and R²", () => {
  it("recovers the slope of a perfect line and R² = 1", () => {
    const xs = [0, 1, 2, 3, 4, 5];
    const ys = xs.map((x) => 20 * x + 3);
    const fit = linearRegression(xs, ys);
    expect(fit.slope).toBeCloseTo(20, 6);
    expect(fit.intercept).toBeCloseTo(3, 6);
    expect(fit.r2).toBeCloseTo(1, 6);
  });

  it("gives a lower R² for noisy data", () => {
    const xs = [0, 1, 2, 3, 4, 5];
    const ys = [0, 25, 38, 61, 79, 110];
    const fit = linearRegression(xs, ys);
    expect(fit.r2).toBeLessThan(1);
    expect(fit.r2).toBeGreaterThan(0.95);
  });
});

describe("integer-second interpolation", () => {
  const samples = makeSamples(20);
  it("interpolates the distance at an exact integer second", () => {
    const v = distanceAtTime(samples, 2);
    expect(v).not.toBeNull();
    expect(v!.valueCm).toBeCloseTo(40, 4);
  });

  it("flags interpolation when no exact sample exists", () => {
    const sparse: MotionSample[] = [samples[0], samples[15], samples[30]];
    const v = distanceAtTime(sparse, 1);
    expect(v!.interpolated).toBe(true);
  });

  it("returns null outside the measured range", () => {
    expect(distanceAtTime(samples, 99)).toBeNull();
  });
});

describe("interval distance and speed", () => {
  it("computes per-second interval distance and average speed", () => {
    const rows = buildTimeDistanceTable(makeSamples(20), 5);
    const intervals = buildIntervalTable(rows);
    expect(intervals).toHaveLength(5);
    expect(intervals[0].label).toBe("0–1");
    expect(intervals[0].intervalDistanceCm).toBeCloseTo(20, 4);
    expect(intervals[0].averageSpeedCmps).toBeCloseTo(20, 4);
  });
});

describe("speed variability", () => {
  it("near-constant speed yields a small coefficient of variation and horizontal verdict", () => {
    const stats = speedStatistics([20, 21, 19, 20, 20.5, 19.5]);
    expect(stats.coefficientOfVariation).toBeLessThan(0.15);
    expect(stats.approximatelyHorizontal).toBe(true);
  });

  it("highly variable speed is not horizontal", () => {
    const stats = speedStatistics([5, 25, 8, 30, 2, 40]);
    expect(stats.approximatelyHorizontal).toBe(false);
  });
});

describe("full analysis", () => {
  it("identifies uniform motion as approximately linear and horizontal", () => {
    const result = analyzeMotion(makeSamples(20));
    expect(result.distance.approximatelyLinear).toBe(true);
    expect(result.speed.approximatelyHorizontal).toBe(true);
    expect(result.distance.fit.slope).toBeCloseTo(20, 1);
  });
});

describe("second-trial comparison", () => {
  it("decides the faster trial from measured average speed, not labels", () => {
    const slow = analyzeMotion(makeSamples(15));
    const fast = analyzeMotion(makeSamples(35));
    const cmp = compareTrials(slow, fast);
    expect(cmp.fasterTrial).toBe(2);
    expect(cmp.steeperTrial).toBe(2);
    expect(cmp.trial2MeanSpeedCmps).toBeGreaterThan(cmp.trial1MeanSpeedCmps);
  });
});
