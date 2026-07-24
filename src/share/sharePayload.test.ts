import { describe, expect, it } from "vitest";
import {
  SHARE_EXPERIMENT_ID,
  buildSharePayload,
  isSharePayload,
  restoreTrials,
  dataSourceLabel,
} from "./sharePayload";
import { createEmptyModel, type TrialData } from "../model";
import {
  analyzeMotion,
  buildIntervalTable,
  buildTimeDistanceTable,
} from "../sensors/motion/motionAnalysis";
import { findForbiddenKeys } from "../geminiPayload";
import type { MotionSample } from "../sensors/types";
import { normalizeCode, CODE_PATTERN } from "./shareClient";

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

function modelWithTrial() {
  const model = createEmptyModel();
  model.identity = {
    school: "경희여자중학교",
    grade: "1",
    classNo: "3",
    studentNo: "11",
    studentName: "홍길동",
    experimentDate: "2026-07-24",
  };
  model.trials = [makeTrial()];
  model.groupLabel = "3모둠";
  return model;
}

describe("share payload — personal information exclusion", () => {
  it("never carries identity fields or their values", () => {
    const payload = buildSharePayload(modelWithTrial(), "3모둠");
    const json = JSON.stringify(payload);

    expect(findForbiddenKeys(payload)).toEqual([]);
    expect(json).not.toContain("경희여자중학교");
    expect(json).not.toContain("홍길동");
    // The anonymous group label IS allowed.
    expect(payload.groupLabel).toBe("3모둠");
  });

  it("stores an empty group label as null rather than a blank string", () => {
    const payload = buildSharePayload(modelWithTrial(), "   ");
    expect(payload.groupLabel).toBeNull();
  });
});

describe("share payload — round trip", () => {
  it("restores trials whose samples and analysis match the original", () => {
    const model = modelWithTrial();
    const payload = buildSharePayload(model, "3모둠");
    const restored = restoreTrials(payload);

    expect(restored).toHaveLength(1);
    const before = model.trials[0];
    const after = restored[0];
    expect(after.samples).toHaveLength(before.samples.length);
    expect(after.label).toBe(before.label);
    expect(after.velocitySource).toBe(before.velocitySource);
    // Analysis is recomputed on the receiving side but must agree.
    expect(after.analysis.distance.fit.slope).toBeCloseTo(before.analysis.distance.fit.slope, 1);
    expect(after.analysis.speed.meanCmps).toBeCloseTo(before.analysis.speed.meanCmps, 1);
    expect(after.timeDistanceTable).toHaveLength(before.timeDistanceTable.length);
  });

  it("recognizes its own payloads and rejects foreign ones", () => {
    const payload = buildSharePayload(modelWithTrial(), "");
    expect(isSharePayload(payload)).toBe(true);
    expect(payload.experiment).toBe(SHARE_EXPERIMENT_ID);
    expect(isSharePayload({ experiment: "lauric-acid-cooling", trials: [] })).toBe(false);
    expect(isSharePayload(null)).toBe(false);
    expect(isSharePayload({ experiment: SHARE_EXPERIMENT_ID, trials: [] })).toBe(false);
  });

  it("drops trials that have too few usable samples to analyse", () => {
    const payload = buildSharePayload(modelWithTrial(), "");
    payload.trials[0].samples = payload.trials[0].samples.slice(0, 2);
    expect(restoreTrials(payload)).toHaveLength(0);
  });
});

describe("provenance label", () => {
  it("reports direct measurement by default and the code when shared", () => {
    const model = createEmptyModel();
    expect(dataSourceLabel(model)).toBe("직접 측정");

    model.dataSource = "shared";
    model.shareCode = "K7QF2M";
    model.sharedFrom = "3모둠";
    expect(dataSourceLabel(model)).toBe("공유 코드 K7QF2M (3모둠)");
  });
});

describe("share code normalization", () => {
  it("upper-cases, strips separators and caps at six characters", () => {
    expect(normalizeCode("k7qf2m")).toBe("K7QF2M");
    expect(normalizeCode(" k7-qf 2m ")).toBe("K7QF2M");
    expect(normalizeCode("K7QF2MEXTRA")).toBe("K7QF2M");
  });

  it("accepts valid codes and rejects ones using excluded characters", () => {
    expect(CODE_PATTERN.test("K7QF2M")).toBe(true);
    // 0, O, 1, I and L are deliberately not in the alphabet.
    expect(CODE_PATTERN.test("K7QF2O")).toBe(false);
    expect(CODE_PATTERN.test("K7QF21")).toBe(false);
    expect(CODE_PATTERN.test("K7QF2")).toBe(false);
  });
});
