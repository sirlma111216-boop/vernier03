/**
 * Measurement controller: baseline collection → countdown → motion-start
 * detection → fixed-duration recording → automatic stop. Emits live processed
 * samples and a final TrialData. All timers are cleaned up on stop/abort.
 */

import type { MotionSensorAdapter, RawMotionSample } from "../sensors/types";
import type { MeasurementSettings, TrialData } from "../model";
import {
  buildMotionSamples,
  isPlausiblePositionM,
  median,
  speedFromVelocityMps,
} from "../sensors/motion/motionDataProcessing";
import {
  analyzeMotion,
  buildIntervalTable,
  buildTimeDistanceTable,
} from "../sensors/motion/motionAnalysis";
import type { MotionSample } from "../sensors/types";

export type MeasurementPhase =
  | "idle"
  | "countdown"
  | "baseline"
  | "waiting-motion"
  | "recording"
  | "done"
  | "error";

export interface MeasurementEvents {
  onPhase?: (phase: MeasurementPhase, message: string) => void;
  onCountdown?: (secondsLeft: number) => void;
  onLiveSample?: (sample: MotionSample) => void;
  onLiveStats?: (stats: {
    elapsedS: number;
    movementCm: number;
    speedCmps: number;
    rawPositionM: number;
  }) => void;
  onReverse?: () => void;
  onComplete?: (trial: Omit<TrialData, "index" | "label" | "requestedProfile">) => void;
  onError?: (message: string) => void;
}

export class MeasurementController {
  private unsubscribe: (() => void) | null = null;
  private phase: MeasurementPhase = "idle";
  private rawDuringMotion: RawMotionSample[] = [];
  private baselineSamples: number[] = [];
  private speedWindow: number[] = [];
  private initialPositionM = 0;
  private startTimeMs = 0;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private recordingStopTimer: ReturnType<typeof setTimeout> | null = null;
  private aborted = false;
  private reversed = false;

  constructor(
    private adapter: MotionSensorAdapter,
    private settings: MeasurementSettings,
    private events: MeasurementEvents,
    private isDemo: boolean,
  ) {}

  /** Begin the full sequence: countdown → baseline → wait → record. */
  async start(): Promise<void> {
    this.reset();
    this.aborted = false;
    await this.runCountdown(3);
    if (this.aborted) return;

    this.setPhase("baseline", "출발 위치를 확인하고 있어요…");
    this.unsubscribe = this.adapter.onSample((s) => this.handleRaw(s));
    await this.adapter.startStreaming({ sampleRateHz: this.settings.sampleRateHz });
  }

  private async runCountdown(seconds: number): Promise<void> {
    this.setPhase("countdown", "측정을 준비해요");
    for (let n = seconds; n > 0; n--) {
      if (this.aborted) return;
      this.events.onCountdown?.(n);
      await this.delay(1000);
    }
  }

  private handleRaw(sample: RawMotionSample): void {
    if (this.aborted) return;
    const pos = sample.rawPositionM;
    if (!isPlausiblePositionM(pos)) return;

    if (this.phase === "baseline") {
      this.baselineSamples.push(pos);
      // ~0.6 s of baseline at the configured rate.
      const needed = Math.max(4, Math.round(this.settings.sampleRateHz * 0.6));
      if (this.baselineSamples.length >= needed) {
        this.initialPositionM = median(this.baselineSamples);
        this.setPhase("waiting-motion", "자동차를 출발시키세요!");
      }
      return;
    }

    if (this.phase === "waiting-motion") {
      const speed = this.instantaneousSpeed(sample);
      this.speedWindow.push(speed);
      if (this.speedWindow.length > 4) this.speedWindow.shift();
      const sustained =
        this.speedWindow.length >= 3 &&
        this.speedWindow.slice(-3).every((v) => v >= this.settings.startThresholdCmps);
      if (sustained) {
        this.startTimeMs = sample.timestampMs;
        this.rawDuringMotion = [sample];
        this.setPhase("recording", "측정 중…");
        this.scheduleStop();
      }
      return;
    }

    if (this.phase === "recording") {
      this.rawDuringMotion.push(sample);
      this.emitLive();
    }
  }

  private instantaneousSpeed(sample: RawMotionSample): number {
    if (sample.rawVelocityMps !== null) return speedFromVelocityMps(sample.rawVelocityMps);
    const prev = this.rawDuringMotion[this.rawDuringMotion.length - 1];
    if (!prev) return 0;
    const dt = (sample.timestampMs - prev.timestampMs) / 1000;
    if (dt <= 0) return 0;
    return Math.abs(((sample.rawPositionM - prev.rawPositionM) * 100) / dt);
  }

  private emitLive(): void {
    const built = buildMotionSamples(this.rawDuringMotion, this.initialPositionM, this.startTimeMs, {
      direction: this.settings.direction,
      preferSensorVelocity: this.settings.preferSensorVelocity,
    });
    if (built.directionChanged && !this.reversed) {
      this.reversed = true;
      this.events.onReverse?.();
    }
    const last = built.samples[built.samples.length - 1];
    if (last) {
      this.events.onLiveSample?.(last);
      this.events.onLiveStats?.({
        elapsedS: last.elapsedTimeS,
        movementCm: last.movementDistanceCm,
        speedCmps: last.speedCmps,
        rawPositionM: last.rawPositionM,
      });
    }
  }

  private scheduleStop(): void {
    this.recordingStopTimer = setTimeout(() => {
      void this.finish();
    }, this.settings.durationS * 1000);
  }

  /** Manual stop — usable at any time. */
  async stop(): Promise<void> {
    if (this.phase === "recording") {
      await this.finish();
    } else {
      await this.abort();
    }
  }

  private async finish(): Promise<void> {
    if (this.phase === "done") return;
    await this.teardownStream();
    this.setPhase("done", "측정 완료");

    const built = buildMotionSamples(this.rawDuringMotion, this.initialPositionM, this.startTimeMs, {
      direction: this.settings.direction,
      preferSensorVelocity: this.settings.preferSensorVelocity,
    });
    const samples: MotionSample[] = built.samples;
    if (samples.length < 4) {
      this.setPhase("error", "측정이 너무 일찍 끝났어요. 다시 측정해 주세요.");
      this.events.onError?.("측정이 너무 일찍 끝났습니다. 다시 측정해 주세요.");
      return;
    }
    const maxSecond = Math.floor(samples[samples.length - 1].elapsedTimeS);
    const timeDistanceTable = buildTimeDistanceTable(samples, Math.max(1, maxSecond));
    const intervalTable = buildIntervalTable(timeDistanceTable);
    const analysis = analyzeMotion(samples);

    this.events.onComplete?.({
      isDemo: this.isDemo,
      samples,
      timeDistanceTable,
      intervalTable,
      analysis,
      velocitySource: built.velocitySource,
      durationS: samples[samples.length - 1].elapsedTimeS,
    });
  }

  async abort(): Promise<void> {
    this.aborted = true;
    await this.teardownStream();
    this.setPhase("idle", "측정을 멈췄어요");
  }

  private async teardownStream(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.recordingStopTimer) {
      clearTimeout(this.recordingStopTimer);
      this.recordingStopTimer = null;
    }
    this.timers.forEach(clearTimeout);
    this.timers = [];
    try {
      await this.adapter.stopStreaming();
    } catch {
      /* ignore */
    }
  }

  reset(): void {
    this.rawDuringMotion = [];
    this.baselineSamples = [];
    this.speedWindow = [];
    this.reversed = false;
    this.phase = "idle";
  }

  private setPhase(phase: MeasurementPhase, message: string): void {
    this.phase = phase;
    this.events.onPhase?.(phase, message);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      this.timers.push(t);
    });
  }
}
