/**
 * Group data sharing payload: build (measurer) and restore (analyst).
 *
 * CRITICAL: the payload carries measurement data ONLY. Personal identity fields
 * (school / grade / class / number / name) stay in the browser and are never
 * uploaded. Only an anonymous group label is allowed.
 *
 * Tables and analysis are NOT transmitted — they are recomputed from the samples
 * with the same pure functions the measurer used, so both sides always agree.
 */

import type { AppModel, MeasurementSettings, TrialData } from "../model";
import type { MotionSample, VelocitySource } from "../sensors/types";
import {
  analyzeMotion,
  buildIntervalTable,
  buildTimeDistanceTable,
} from "../sensors/motion/motionAnalysis";

export const SHARE_EXPERIMENT_ID = "uniform-motion-graphs";
export const SHARE_PAYLOAD_VERSION = 1;

/** Compact per-sample tuple: time(s), movement(cm), speed(cm/s), sensor distance(m). */
export interface SharedSample {
  t: number;
  d: number;
  s: number;
  p: number;
}

export interface SharedTrial {
  index: 1 | 2;
  label: string;
  isDemo: boolean;
  durationS: number;
  velocitySource: VelocitySource;
  samples: SharedSample[];
}

export interface SharePayload {
  version: number;
  experiment: string;
  /** Anonymous group label only — never a personal name. */
  groupLabel: string | null;
  recordedAt: string;
  settings: {
    durationS: number;
    sampleRateHz: number;
    direction: MeasurementSettings["direction"];
    preferSensorVelocity: boolean;
  };
  trials: SharedTrial[];
}

function round(n: number, digits: number): number {
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** Builds the upload payload from measured trials. Contains no personal data. */
export function buildSharePayload(model: AppModel, groupLabel: string): SharePayload {
  const s = model.measurementSettings;
  return {
    version: SHARE_PAYLOAD_VERSION,
    experiment: SHARE_EXPERIMENT_ID,
    groupLabel: groupLabel.trim() || null,
    recordedAt: new Date().toISOString(),
    settings: {
      durationS: s.durationS,
      sampleRateHz: s.sampleRateHz,
      direction: s.direction,
      preferSensorVelocity: s.preferSensorVelocity,
    },
    trials: model.trials.map((t) => ({
      index: t.index,
      label: t.label,
      isDemo: t.isDemo,
      durationS: round(t.durationS, 3),
      velocitySource: t.velocitySource,
      samples: t.samples.map((sample) => ({
        t: round(sample.elapsedTimeS, 3),
        d: round(sample.movementDistanceCm, 2),
        s: round(sample.speedCmps, 2),
        p: round(sample.rawPositionM, 4),
      })),
    })),
  };
}

/** True when the object looks like a payload this app can restore. */
export function isSharePayload(value: unknown): value is SharePayload {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<SharePayload>;
  if (p.experiment !== SHARE_EXPERIMENT_ID) return false;
  return Array.isArray(p.trials) && p.trials.length > 0;
}

function toMotionSamples(trial: SharedTrial): MotionSample[] {
  return trial.samples
    .map((s) => ({
      timestampMs: Number(s.t) * 1000,
      elapsedTimeS: Number(s.t),
      rawPositionM: Number(s.p),
      rawVelocityMps: null,
      movementDistanceCm: Number(s.d),
      speedCmps: Number(s.s),
      positionValid: true,
      velocitySource: trial.velocitySource,
    }))
    .filter(
      (s) =>
        Number.isFinite(s.elapsedTimeS) &&
        Number.isFinite(s.movementDistanceCm) &&
        Number.isFinite(s.speedCmps),
    );
}

/**
 * Rebuilds full TrialData (tables + analysis recomputed locally) from a payload.
 * Trials with too few usable samples are dropped.
 */
export function restoreTrials(payload: SharePayload): TrialData[] {
  const out: TrialData[] = [];
  payload.trials.forEach((shared, i) => {
    const samples = toMotionSamples(shared);
    if (samples.length < 4) return;
    const lastT = samples[samples.length - 1].elapsedTimeS;
    const timeDistanceTable = buildTimeDistanceTable(samples, Math.max(1, Math.floor(lastT)));
    const index = (shared.index === 2 ? 2 : (i === 0 ? 1 : 2)) as 1 | 2;
    out.push({
      index,
      isDemo: shared.isDemo === true,
      label: shared.label || `${index}차 측정`,
      samples,
      timeDistanceTable,
      intervalTable: buildIntervalTable(timeDistanceTable),
      analysis: analyzeMotion(samples),
      velocitySource: shared.velocitySource === "sensor" ? "sensor" : "derived",
      durationS: Number.isFinite(shared.durationS) ? shared.durationS : lastT,
    });
  });
  return out;
}

/** Human-readable provenance shown on screen and recorded in the report. */
export function dataSourceLabel(model: AppModel): string {
  if (model.dataSource !== "shared") return "직접 측정";
  const from = model.sharedFrom ? ` (${model.sharedFrom})` : "";
  return `공유 코드 ${model.shareCode ?? "—"}${from}`;
}
