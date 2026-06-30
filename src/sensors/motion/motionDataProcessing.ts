/**
 * Pure data-processing functions for the uniform-motion experiment.
 * Everything here is deterministic and unit-tested (motionDataProcessing.test.ts).
 */

import type {
  ExperimentDirection,
  MotionSample,
  RawMotionSample,
  VelocitySource,
} from "../types";

// --- Physically-plausible bounds for the PASCO ultrasonic motion sensor ---
// Classroom-reliable detection range is roughly 0.15 m – 4 m.
export const MIN_VALID_POSITION_M = 0.1;
export const MAX_VALID_POSITION_M = 6.0;
/** A single-sample jump larger than this (m) between consecutive ~10 Hz samples is implausible. */
export const MAX_POSITION_JUMP_M = 1.0;

// --- Unit conversions -------------------------------------------------------

export function meterToCm(meters: number): number {
  return meters * 100;
}

export function mpsToCmps(mps: number): number {
  return mps * 100;
}

/** Speed is the non-negative magnitude of velocity, expressed in cm/s. */
export function speedFromVelocityMps(velocityMps: number): number {
  return Math.abs(mpsToCmps(velocityMps));
}

// --- Validity ---------------------------------------------------------------

export function isPlausiblePositionM(positionM: number): boolean {
  return (
    Number.isFinite(positionM) &&
    positionM >= MIN_VALID_POSITION_M &&
    positionM <= MAX_VALID_POSITION_M
  );
}

/** Detects a physically impossible sudden jump between two consecutive positions. */
export function isPositionJump(prevM: number, nextM: number): boolean {
  return Math.abs(nextM - prevM) > MAX_POSITION_JUMP_M;
}

// --- Movement distance normalization ---------------------------------------

/**
 * Movement distance from the starting point in cm.
 * We do NOT sum absolute differences (that amplifies noise); we normalize
 * one-direction motion against the starting position.
 */
export function movementDistanceCm(
  currentPositionM: number,
  initialPositionM: number,
  direction: ExperimentDirection,
  resolvedAwayWhenAuto = true,
): number {
  let movingAway: boolean;
  if (direction === "away") movingAway = true;
  else if (direction === "toward") movingAway = false;
  else movingAway = resolvedAwayWhenAuto;

  const deltaCm = movingAway
    ? (currentPositionM - initialPositionM) * 100
    : (initialPositionM - currentPositionM) * 100;
  return deltaCm;
}

/**
 * Resolve "auto" direction from the net displacement between the first and
 * last reliable positions. Returns whether the object moved away from sensor.
 */
export function resolveAutoDirectionAway(
  initialPositionM: number,
  finalPositionM: number,
): boolean {
  return finalPositionM >= initialPositionM;
}

/**
 * Detects whether the object reversed direction during the run.
 * Looks at the sign of consecutive movement-distance deltas, ignoring tiny
 * (noise-level) changes. Returns true if there is meaningful motion in both
 * the positive and negative directions.
 */
export function detectsDirectionChange(
  movementCm: number[],
  noiseToleranceCm = 1.5,
): boolean {
  let sawForward = false;
  let sawBackward = false;
  for (let i = 1; i < movementCm.length; i++) {
    const d = movementCm[i] - movementCm[i - 1];
    if (d > noiseToleranceCm) sawForward = true;
    if (d < -noiseToleranceCm) sawBackward = true;
    if (sawForward && sawBackward) return true;
  }
  return false;
}

// --- Noise reduction --------------------------------------------------------

/**
 * Median filter over a centered window. The window shrinks SYMMETRICALLY near
 * the edges (radius = min(half, i, n-1-i)) so the first and last samples are
 * left unchanged — important so the movement-distance graph starts at ~0.
 */
export function medianFilter(values: number[], windowSize = 3): number[] {
  if (windowSize < 2 || values.length === 0) return values.slice();
  const half = Math.floor(windowSize / 2);
  const n = values.length;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.min(half, i, n - 1 - i);
    const slice = values.slice(i - r, i + r + 1).sort((a, b) => a - b);
    out.push(slice[Math.floor(slice.length / 2)]);
  }
  return out;
}

/** Short trailing moving average for light display smoothing. */
export function movingAverage(values: number[], windowSize = 3): number[] {
  if (windowSize < 2 || values.length === 0) return values.slice();
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const lo = Math.max(0, i - (windowSize - 1));
    let sum = 0;
    for (let j = lo; j <= i; j++) sum += values[j];
    out.push(sum / (i - lo + 1));
  }
  return out;
}

// --- Motion-start detection -------------------------------------------------

/**
 * Returns the index at which sustained motion begins, or -1 if not found.
 * Requires the instantaneous speed to exceed `thresholdCmps` for
 * `consecutive` samples in a row, so a single noisy sample never triggers.
 */
export function detectMotionStartIndex(
  speedsCmps: number[],
  thresholdCmps = 4,
  consecutive = 3,
): number {
  let run = 0;
  for (let i = 0; i < speedsCmps.length; i++) {
    if (speedsCmps[i] >= thresholdCmps) {
      run++;
      if (run >= consecutive) return i - consecutive + 1;
    } else {
      run = 0;
    }
  }
  return -1;
}

/** Median of an array (full precision). */
export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// --- Derived velocity (when the sensor velocity is unavailable) -------------

/**
 * Central-difference / local-linear-fit speed at index i over a small time
 * window, in cm/s. Uses a local linear regression of position vs. time across
 * the window so a single noisy sample cannot dominate. Returns non-negative cm/s.
 */
export function derivedSpeedCmps(
  positionsM: number[],
  timesS: number[],
  index: number,
  halfWindow = 2,
): number {
  const lo = Math.max(0, index - halfWindow);
  const hi = Math.min(positionsM.length - 1, index + halfWindow);
  const xs = timesS.slice(lo, hi + 1);
  const ys = positionsM.slice(lo, hi + 1).map((m) => m * 100); // cm
  if (xs.length < 2) return 0;
  const slope = linearSlope(xs, ys); // cm per s
  return Math.abs(slope);
}

/** Ordinary-least-squares slope of y vs x. */
export function linearSlope(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
    sxx += xs[i] * xs[i];
    sxy += xs[i] * ys[i];
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return 0;
  return (n * sxy - sx * sy) / denom;
}

// --- Building processed samples --------------------------------------------

export interface BuildSamplesOptions {
  direction: ExperimentDirection;
  /** Whether to prefer sensor velocity over derived velocity. */
  preferSensorVelocity: boolean;
  /** Median-filter window for position de-noising. */
  positionFilterWindow?: number;
}

export interface BuiltSamples {
  samples: MotionSample[];
  initialPositionM: number;
  velocitySource: VelocitySource;
  directionChanged: boolean;
  resolvedAway: boolean;
}

/**
 * Converts a baseline-zeroed list of raw samples (already trimmed to t >= 0)
 * into fully processed MotionSamples. The first sample defines t = 0 and the
 * starting position. Raw values are preserved on each output sample.
 */
export function buildMotionSamples(
  raw: RawMotionSample[],
  initialPositionM: number,
  startTimeMs: number,
  options: BuildSamplesOptions,
): BuiltSamples {
  const valid = raw.filter((r) => isPlausiblePositionM(r.rawPositionM));
  const positionsM = valid.map((r) => r.rawPositionM);
  const timesS = valid.map((r) => (r.timestampMs - startTimeMs) / 1000);

  const resolvedAway =
    options.direction === "auto"
      ? resolveAutoDirectionAway(
          initialPositionM,
          positionsM.length ? positionsM[positionsM.length - 1] : initialPositionM,
        )
      : options.direction === "away";

  const filtered = medianFilter(positionsM, options.positionFilterWindow ?? 3);

  // Decide velocity source: sensor if requested AND available on most samples.
  const sensorVelocityCount = valid.filter((r) => r.rawVelocityMps !== null).length;
  const useSensor =
    options.preferSensorVelocity && sensorVelocityCount >= Math.ceil(valid.length / 2);
  const velocitySource: VelocitySource = useSensor ? "sensor" : "derived";

  const movementCm = filtered.map((m) =>
    movementDistanceCm(m, initialPositionM, options.direction, resolvedAway),
  );

  const samples: MotionSample[] = valid.map((r, i) => {
    let speed: number;
    if (useSensor && r.rawVelocityMps !== null) {
      speed = speedFromVelocityMps(r.rawVelocityMps);
    } else {
      speed = derivedSpeedCmps(filtered, timesS, i);
    }
    return {
      timestampMs: r.timestampMs,
      elapsedTimeS: timesS[i],
      rawPositionM: r.rawPositionM,
      rawVelocityMps: r.rawVelocityMps,
      movementDistanceCm: movementCm[i],
      speedCmps: speed,
      positionValid: true,
      velocitySource: useSensor && r.rawVelocityMps !== null ? "sensor" : "derived",
    };
  });

  return {
    samples,
    initialPositionM,
    velocitySource,
    directionChanged: detectsDirectionChange(movementCm),
    resolvedAway,
  };
}
