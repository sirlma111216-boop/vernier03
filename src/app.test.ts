import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { buildGeminiPayload, downsample, findForbiddenKeys } from "./geminiPayload";
import { createEmptyModel, type TrialData } from "./model";
import {
  analyzeMotion,
  buildIntervalTable,
  buildTimeDistanceTable,
} from "./sensors/motion/motionAnalysis";
import type { MotionSample } from "./sensors/types";
import { DemoMotionAdapter } from "./sensors/demo/DemoMotionAdapter";

function makeSamples(speedCmps: number): MotionSample[] {
  const out: MotionSample[] = [];
  for (let i = 0; i <= 50; i++) {
    const t = i / 10;
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

function makeTrial(): TrialData {
  const samples = makeSamples(20);
  const timeDistanceTable = buildTimeDistanceTable(samples, 5);
  return {
    index: 1,
    isDemo: false,
    label: "1차 측정",
    samples,
    timeDistanceTable,
    intervalTable: buildIntervalTable(timeDistanceTable),
    analysis: analyzeMotion(samples),
    velocitySource: "sensor",
    durationS: 5,
  };
}

describe("Gemini payload — personal information exclusion", () => {
  it("never includes identity fields anywhere in the payload", () => {
    const model = createEmptyModel();
    model.identity = {
      school: "경희여자중학교",
      grade: "1",
      classNo: "3",
      studentNo: "11",
      studentName: "홍길동",
      experimentDate: "2026-06-30",
    };
    model.trials = [makeTrial()];
    model.studentConclusion = "등속 운동입니다.";

    const payload = buildGeminiPayload(model);
    const json = JSON.stringify(payload);

    expect(findForbiddenKeys(payload)).toEqual([]);
    expect(json).not.toContain("경희여자중학교");
    expect(json).not.toContain("홍길동");
    expect(payload.hasSubmittedConclusion).toBe(true);
  });

  it("downsamples long series to a bounded number of points", () => {
    expect(downsample(makeSamples(20), 10)).toHaveLength(10);
  });
});

describe("report data integrity", () => {
  it("keeps the integer-second table and intervals consistent with samples", () => {
    const trial = makeTrial();
    expect(trial.timeDistanceTable).toHaveLength(6); // 0..5
    expect(trial.intervalTable).toHaveLength(5);
    // Sum of interval distances equals total movement distance.
    const sum = trial.intervalTable.reduce(
      (a, r) => a + (r.intervalDistanceCm ?? 0),
      0,
    );
    expect(sum).toBeCloseTo(trial.analysis.distance.totalMovementCm, 1);
  });
});

describe("demo mode labeling", () => {
  it("demo diagnostics are flagged isDemo and show 시연 state", async () => {
    const demo = new DemoMotionAdapter({ profile: "slow" });
    const info = await demo.connect();
    const diag = demo.getDiagnostics();
    expect(diag.isDemo).toBe(true);
    expect(info.deviceName).toContain("시연");
    expect(diag.connectionState).toContain("시연");
    await demo.disconnect();
  });
});

describe("disconnect cleanup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops streaming and fires disconnect callbacks exactly once", async () => {
    const demo = new DemoMotionAdapter({ profile: "fast" });
    await demo.connect();
    const onDisc = vi.fn();
    demo.onDisconnect(onDisc);
    let count = 0;
    demo.onSample(() => count++);
    await demo.startStreaming({ sampleRateHz: 10 });
    await vi.advanceTimersByTimeAsync(300);
    expect(count).toBeGreaterThan(0);

    await demo.disconnect();
    const afterDisconnect = count;
    await vi.advanceTimersByTimeAsync(300);
    expect(count).toBe(afterDisconnect); // no samples after cleanup
    expect(onDisc).toHaveBeenCalledTimes(1);
    expect(demo.isConnected()).toBe(false);
  });
});
