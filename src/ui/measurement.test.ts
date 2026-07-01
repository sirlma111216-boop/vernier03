import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { MeasurementController } from "./measurement";
import { DEFAULT_SETTINGS, type MeasurementSettings } from "../model";
import type {
  MotionSensorAdapter,
  MotionSensorConnectionInfo,
  MotionSensorDiagnostics,
  RawMotionSample,
} from "../sensors/types";

/** Minimal adapter whose samples we push by hand. Velocity is null (derived). */
class FakeAdapter implements MotionSensorAdapter {
  private cbs = new Set<(s: RawMotionSample) => void>();
  streaming = false;
  emit(positionM: number, timestampMs: number): void {
    this.cbs.forEach((cb) =>
      cb({ timestampMs, rawPositionM: positionM, rawVelocityMps: null }),
    );
  }
  onSample(cb: (s: RawMotionSample) => void): () => void {
    this.cbs.add(cb);
    return () => this.cbs.delete(cb);
  }
  async connect(): Promise<MotionSensorConnectionInfo> {
    return { deviceName: "x", sensorId: "x", interfaceId: null, availableMeasurements: [], hasValidPosition: true };
  }
  async disconnect(): Promise<void> {}
  isConnected(): boolean { return true; }
  getAvailableMeasurements(): string[] { return ["Position"]; }
  async readPosition(): Promise<number> { return 0.3; }
  async readVelocity(): Promise<number | null> { return null; }
  async startStreaming(): Promise<void> { this.streaming = true; }
  async stopStreaming(): Promise<void> { this.streaming = false; }
  onDisconnect(): () => void { return () => {}; }
  getDiagnostics(): MotionSensorDiagnostics { return {} as MotionSensorDiagnostics; }
}

describe("MeasurementController — motion detection from position-only samples", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("detects motion and completes a trial when the sensor gives no velocity", async () => {
    const adapter = new FakeAdapter();
    const settings: MeasurementSettings = {
      ...DEFAULT_SETTINGS,
      durationS: 1,
      sampleRateHz: 10,
      startThresholdCmps: 4,
      preferSensorVelocity: false,
      enableSecondTrial: false,
    };
    const onComplete = vi.fn();
    let reachedWaiting = false;
    const controller = new MeasurementController(
      adapter,
      settings,
      {
        onPhase: (p) => { if (p === "waiting-motion") reachedWaiting = true; },
        onComplete,
      },
      false,
    );

    void controller.start();
    await vi.advanceTimersByTimeAsync(3000); // pass the 3s countdown

    let t = 100000;
    // Baseline: 6 constant-position samples (car at rest at 0.30 m).
    for (let i = 0; i < 6; i++) {
      adapter.emit(0.3, t);
      t += 100;
    }
    expect(reachedWaiting).toBe(true);

    // Car starts moving away: +2 cm per 100 ms = 20 cm/s (> 4 threshold).
    let pos = 0.3;
    for (let i = 0; i < 15; i++) {
      pos += 0.02;
      adapter.emit(pos, t);
      t += 100;
    }

    // Fire the automatic-stop timer (durationS = 1 s).
    await vi.advanceTimersByTimeAsync(1000);

    expect(onComplete).toHaveBeenCalledTimes(1);
    const trial = onComplete.mock.calls[0][0];
    expect(trial.samples.length).toBeGreaterThanOrEqual(4);
    // Movement distance increases; speed is derived (~20 cm/s).
    expect(trial.samples[trial.samples.length - 1].movementDistanceCm).toBeGreaterThan(5);
    expect(trial.velocitySource).toBe("derived");
  });
});
