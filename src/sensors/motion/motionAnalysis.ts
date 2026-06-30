/**
 * Deterministic scientific analysis computed BEFORE any AI call:
 * regression, R², integer-second table, interval table, speed statistics.
 * All pure and unit-tested (motionAnalysis.test.ts).
 */

import type { MotionSample } from "../types";
import { linearSlope, median } from "./motionDataProcessing";

export interface LinearFit {
  slope: number; // cm per s
  intercept: number; // cm
  r2: number;
  /** Root-mean-square residual in cm. */
  rmseCm: number;
}

/** Ordinary least-squares fit of distance(cm) vs time(s) with R². */
export function linearRegression(xs: number[], ys: number[]): LinearFit {
  const n = xs.length;
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0, r2: 0, rmseCm: 0 };
  const slope = linearSlope(xs, ys);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  const intercept = meanY - slope * meanX;

  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const pred = slope * xs[i] + intercept;
    ssRes += (ys[i] - pred) ** 2;
    ssTot += (ys[i] - meanY) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  const rmseCm = Math.sqrt(ssRes / n);
  return { slope, intercept, r2, rmseCm };
}

/**
 * Value of movement distance at an exact integer second by linear interpolation
 * between the two nearest samples. Returns null if the time is out of range.
 */
export function distanceAtTime(
  samples: MotionSample[],
  timeS: number,
): { valueCm: number; interpolated: boolean } | null {
  if (samples.length === 0) return null;
  // Exact (or near-exact) sample match.
  for (const s of samples) {
    if (Math.abs(s.elapsedTimeS - timeS) < 1e-6) {
      return { valueCm: s.movementDistanceCm, interpolated: false };
    }
  }
  if (timeS < samples[0].elapsedTimeS || timeS > samples[samples.length - 1].elapsedTimeS) {
    return null;
  }
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (timeS >= a.elapsedTimeS && timeS <= b.elapsedTimeS) {
      const t = (timeS - a.elapsedTimeS) / (b.elapsedTimeS - a.elapsedTimeS);
      const valueCm = a.movementDistanceCm + t * (b.movementDistanceCm - a.movementDistanceCm);
      return { valueCm, interpolated: true };
    }
  }
  return null;
}

export interface TimeDistanceRow {
  timeS: number;
  distanceCm: number | null;
  interpolated: boolean;
}

/** Textbook table at 0,1,2,…,maxSecond seconds. */
export function buildTimeDistanceTable(
  samples: MotionSample[],
  maxSecond: number,
): TimeDistanceRow[] {
  const rows: TimeDistanceRow[] = [];
  for (let t = 0; t <= maxSecond; t++) {
    const v = distanceAtTime(samples, t);
    rows.push({
      timeS: t,
      distanceCm: v ? v.valueCm : null,
      interpolated: v ? v.interpolated : false,
    });
  }
  return rows;
}

export interface IntervalRow {
  label: string; // "0–1"
  startS: number;
  endS: number;
  intervalDistanceCm: number | null;
  averageSpeedCmps: number | null;
}

/** Interval distance and average speed for each 1-second interval. */
export function buildIntervalTable(rows: TimeDistanceRow[]): IntervalRow[] {
  const out: IntervalRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    const dt = b.timeS - a.timeS;
    let intervalDistanceCm: number | null = null;
    let averageSpeedCmps: number | null = null;
    if (a.distanceCm !== null && b.distanceCm !== null && dt > 0) {
      intervalDistanceCm = b.distanceCm - a.distanceCm;
      averageSpeedCmps = intervalDistanceCm / dt;
    }
    out.push({
      label: `${a.timeS}–${b.timeS}`,
      startS: a.timeS,
      endS: b.timeS,
      intervalDistanceCm,
      averageSpeedCmps,
    });
  }
  return out;
}

export interface SpeedStats {
  meanCmps: number;
  medianCmps: number;
  minCmps: number;
  maxCmps: number;
  stdDevCmps: number;
  /** Coefficient of variation = stdDev / mean (relative variation). */
  coefficientOfVariation: number;
  approximatelyHorizontal: boolean;
}

export function speedStatistics(
  speedsCmps: number[],
  horizontalCvThreshold = 0.15,
): SpeedStats {
  const n = speedsCmps.length;
  if (n === 0) {
    return {
      meanCmps: 0,
      medianCmps: 0,
      minCmps: 0,
      maxCmps: 0,
      stdDevCmps: 0,
      coefficientOfVariation: 0,
      approximatelyHorizontal: false,
    };
  }
  const mean = speedsCmps.reduce((a, b) => a + b, 0) / n;
  const variance = speedsCmps.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);
  const cv = mean === 0 ? 0 : stdDev / mean;
  return {
    meanCmps: mean,
    medianCmps: median(speedsCmps),
    minCmps: Math.min(...speedsCmps),
    maxCmps: Math.max(...speedsCmps),
    stdDevCmps: stdDev,
    coefficientOfVariation: cv,
    approximatelyHorizontal: cv <= horizontalCvThreshold,
  };
}

export interface DistanceAnalysis {
  startDistanceCm: number;
  endDistanceCm: number;
  totalMovementCm: number;
  durationS: number;
  fit: LinearFit;
  approximatelyLinear: boolean;
}

export interface MotionAnalysisResult {
  distance: DistanceAnalysis;
  speed: SpeedStats;
}

export interface AnalysisOptions {
  /** Seconds of start/stop transient to ignore for the uniform-motion fit. */
  trimEdgeSeconds?: number;
  /** R² above this is treated as "approximately linear" for the classroom. */
  linearR2Threshold?: number;
  horizontalCvThreshold?: number;
}

/**
 * Full deterministic analysis. Trims short start/stop transients from the
 * uniform-motion quality judgement, but callers keep all samples for graphing.
 */
export function analyzeMotion(
  samples: MotionSample[],
  options: AnalysisOptions = {},
): MotionAnalysisResult {
  const trim = options.trimEdgeSeconds ?? 0.2;
  const r2Threshold = options.linearR2Threshold ?? 0.98;

  const lastT = samples.length ? samples[samples.length - 1].elapsedTimeS : 0;
  const core = samples.filter(
    (s) => s.elapsedTimeS >= trim && s.elapsedTimeS <= lastT - trim,
  );
  const used = core.length >= 4 ? core : samples;

  const xs = used.map((s) => s.elapsedTimeS);
  const distanceYs = used.map((s) => s.movementDistanceCm);
  const fit = linearRegression(xs, distanceYs);

  const allDistances = samples.map((s) => s.movementDistanceCm);
  const distance: DistanceAnalysis = {
    startDistanceCm: allDistances.length ? allDistances[0] : 0,
    endDistanceCm: allDistances.length ? allDistances[allDistances.length - 1] : 0,
    totalMovementCm: allDistances.length
      ? allDistances[allDistances.length - 1] - allDistances[0]
      : 0,
    durationS: lastT,
    fit,
    approximatelyLinear: fit.r2 >= r2Threshold,
  };

  const speed = speedStatistics(
    used.map((s) => s.speedCmps),
    options.horizontalCvThreshold,
  );

  return { distance, speed };
}

export interface TrialComparison {
  fasterTrial: 1 | 2;
  trial1MeanSpeedCmps: number;
  trial2MeanSpeedCmps: number;
  trial1SlopeCmps: number;
  trial2SlopeCmps: number;
  /** Which trial's distance–time graph is steeper (matches faster trial). */
  steeperTrial: 1 | 2;
}

/**
 * Compares two trials. The faster trial is decided by MEASURED average speed,
 * never by which button the student pressed.
 */
export function compareTrials(
  a: MotionAnalysisResult,
  b: MotionAnalysisResult,
): TrialComparison {
  const fasterTrial: 1 | 2 = a.speed.meanCmps >= b.speed.meanCmps ? 1 : 2;
  const steeperTrial: 1 | 2 =
    Math.abs(a.distance.fit.slope) >= Math.abs(b.distance.fit.slope) ? 1 : 2;
  return {
    fasterTrial,
    trial1MeanSpeedCmps: a.speed.meanCmps,
    trial2MeanSpeedCmps: b.speed.meanCmps,
    trial1SlopeCmps: a.distance.fit.slope,
    trial2SlopeCmps: b.distance.fit.slope,
    steeperTrial,
  };
}
