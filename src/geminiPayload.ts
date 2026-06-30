/**
 * Builds the payload sent to the secure Gemini backend.
 * CRITICAL: personal identity fields are never included.
 */

import type { AppModel, TrialData } from "./model";
import type { MotionSample } from "./sensors/types";

export interface GeminiTrialPayload {
  label: string;
  isDemo: boolean;
  durationS: number;
  velocitySource: "sensor" | "derived";
  timeDistance: { t: number; d: number | null }[];
  intervalDistances: { interval: string; distanceCm: number | null }[];
  intervalSpeeds: { interval: string; speedCmps: number | null }[];
  distanceTimeSeries: { t: number; cm: number }[];
  speedTimeSeries: { t: number; cmps: number }[];
  regressionSlopeCmps: number;
  regressionR2: number;
  averageSpeedCmps: number;
  speedCoefficientOfVariation: number;
  approximatelyLinear: boolean;
  approximatelyHorizontal: boolean;
}

export interface GeminiPayload {
  predictions: AppModel["predictions"];
  trials: GeminiTrialPayload[];
  comparison: AppModel["comparison"];
  analysisAnswers: AppModel["analysisAnswers"];
  studentConclusion: string;
  /** Whether the student has submitted a conclusion (gates model conclusion). */
  hasSubmittedConclusion: boolean;
}

/** Downsample a series to at most `maxPoints` evenly-spaced points. */
export function downsample(
  samples: MotionSample[],
  maxPoints: number,
): MotionSample[] {
  if (samples.length <= maxPoints) return samples.slice();
  const step = (samples.length - 1) / (maxPoints - 1);
  const out: MotionSample[] = [];
  for (let i = 0; i < maxPoints; i++) {
    out.push(samples[Math.round(i * step)]);
  }
  return out;
}

function round(n: number | null, digits = 2): number | null {
  if (n === null || !Number.isFinite(n)) return n;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function buildTrialPayload(trial: TrialData): GeminiTrialPayload {
  const ds = downsample(trial.samples, 30);
  return {
    label: trial.label,
    isDemo: trial.isDemo,
    durationS: round(trial.durationS) ?? 0,
    velocitySource: trial.velocitySource,
    timeDistance: trial.timeDistanceTable.map((r) => ({
      t: r.timeS,
      d: round(r.distanceCm),
    })),
    intervalDistances: trial.intervalTable.map((r) => ({
      interval: r.label,
      distanceCm: round(r.intervalDistanceCm),
    })),
    intervalSpeeds: trial.intervalTable.map((r) => ({
      interval: r.label,
      speedCmps: round(r.averageSpeedCmps),
    })),
    distanceTimeSeries: ds.map((s) => ({
      t: round(s.elapsedTimeS) ?? 0,
      cm: round(s.movementDistanceCm) ?? 0,
    })),
    speedTimeSeries: ds.map((s) => ({
      t: round(s.elapsedTimeS) ?? 0,
      cmps: round(s.speedCmps) ?? 0,
    })),
    regressionSlopeCmps: round(trial.analysis.distance.fit.slope) ?? 0,
    regressionR2: round(trial.analysis.distance.fit.r2, 3) ?? 0,
    averageSpeedCmps: round(trial.analysis.speed.meanCmps) ?? 0,
    speedCoefficientOfVariation:
      round(trial.analysis.speed.coefficientOfVariation, 3) ?? 0,
    approximatelyLinear: trial.analysis.distance.approximatelyLinear,
    approximatelyHorizontal: trial.analysis.speed.approximatelyHorizontal,
  };
}

/**
 * Build the Gemini payload from the full app model, OMITTING all personal
 * identity fields (school/grade/class/number/name and report-only fields).
 */
export function buildGeminiPayload(model: AppModel): GeminiPayload {
  return {
    predictions: model.predictions,
    trials: model.trials.map(buildTrialPayload),
    comparison: model.comparison,
    analysisAnswers: model.analysisAnswers,
    studentConclusion: model.studentConclusion,
    hasSubmittedConclusion: model.studentConclusion.trim().length > 0,
  };
}

/** Identity field names that must never leave the browser. */
export const FORBIDDEN_KEYS = [
  "school",
  "grade",
  "classNo",
  "studentNo",
  "studentName",
  "identity",
];

/** Test helper: returns any forbidden key found anywhere in an object graph. */
export function findForbiddenKeys(obj: unknown, found: string[] = []): string[] {
  if (obj && typeof obj === "object") {
    for (const [key, value] of Object.entries(obj)) {
      if (FORBIDDEN_KEYS.includes(key)) found.push(key);
      findForbiddenKeys(value, found);
    }
  }
  return found;
}
