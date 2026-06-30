/**
 * Demo adapter: scientifically realistic uniform motion with a short
 * acceleration phase, a short slowing phase, and small measurement noise.
 * Clearly flagged as demo (isDemo: true) and never stored as real sensor data.
 */

import type {
  MotionSensorAdapter,
  MotionSensorConnectionInfo,
  MotionSensorDiagnostics,
  MotionStreamingOptions,
  RawMotionSample,
} from "../types";
import { DiagnosticsCollector } from "../pasco/pascoDiagnostics";

export type DemoSpeedProfile = "slow" | "fast";

export interface DemoOptions {
  profile: DemoSpeedProfile;
  /** Cruise speed in m/s (defaults derived from profile). */
  cruiseSpeedMps?: number;
  startPositionM?: number;
  noiseM?: number;
}

export class DemoMotionAdapter implements MotionSensorAdapter {
  private diag = new DiagnosticsCollector(true);
  private connected = false;
  private streaming = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private startMs = 0;
  private sampleCallbacks = new Set<(s: RawMotionSample) => void>();
  private disconnectCallbacks = new Set<() => void>();

  private readonly cruiseSpeedMps: number;
  private readonly startPositionM: number;
  private readonly noiseM: number;

  constructor(options: DemoOptions) {
    this.cruiseSpeedMps =
      options.cruiseSpeedMps ?? (options.profile === "fast" ? 0.45 : 0.18);
    this.startPositionM = options.startPositionM ?? 0.25;
    this.noiseM = options.noiseM ?? 0.004;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getAvailableMeasurements(): string[] {
    return ["Position", "Velocity"];
  }

  getDiagnostics(): MotionSensorDiagnostics {
    return this.diag.snapshot();
  }

  onSample(cb: (s: RawMotionSample) => void): () => void {
    this.sampleCallbacks.add(cb);
    return () => this.sampleCallbacks.delete(cb);
  }

  onDisconnect(cb: () => void): () => void {
    this.disconnectCallbacks.add(cb);
    return () => this.disconnectCallbacks.delete(cb);
  }

  async connect(): Promise<MotionSensorConnectionInfo> {
    this.diag.setState("센서 없이 시연 중");
    this.diag.setDevice("Demo Motion (시연)", "DEMO000", 1024);
    this.diag.setMeasurements(["Motion"], ["Position", "Velocity"], ["m", "m/s"]);
    this.connected = true;
    return {
      deviceName: "Demo Motion (시연)",
      sensorId: "DEMO000",
      interfaceId: 1024,
      availableMeasurements: this.getAvailableMeasurements(),
      hasValidPosition: true,
    };
  }

  /** Ideal position(m) and signed velocity(m/s) at elapsed time t (s). */
  private modelAt(t: number): { positionM: number; velocityMps: number } {
    const accelPhase = 0.4; // gentle start
    const v = this.cruiseSpeedMps;
    let velocity: number;
    let distance: number;
    if (t < accelPhase) {
      // ramp up linearly to cruise speed
      velocity = v * (t / accelPhase);
      distance = 0.5 * (v / accelPhase) * t * t;
    } else {
      velocity = v;
      distance = 0.5 * v * accelPhase + v * (t - accelPhase);
    }
    return { positionM: this.startPositionM + distance, velocityMps: velocity };
  }

  private noise(scale: number): number {
    return (Math.random() - 0.5) * 2 * scale;
  }

  async readPosition(): Promise<number> {
    return this.modelAt(0).positionM + this.noise(this.noiseM);
  }

  async readVelocity(): Promise<number | null> {
    return this.modelAt(0).velocityMps;
  }

  async startStreaming(options: MotionStreamingOptions): Promise<void> {
    if (this.streaming) return;
    this.streaming = true;
    this.startMs = performance.now();
    const intervalMs = Math.max(20, Math.round(1000 / options.sampleRateHz));
    this.timer = setInterval(() => {
      const t = (performance.now() - this.startMs) / 1000;
      const model = this.modelAt(t);
      const positionM = model.positionM + this.noise(this.noiseM);
      const velocityMps = model.velocityMps + this.noise(0.01);
      this.diag.recordSample(
        positionM,
        velocityMps,
        null,
        { Position: positionM, Velocity: velocityMps },
        "sensor",
      );
      const sample: RawMotionSample = {
        timestampMs: performance.now(),
        rawPositionM: positionM,
        rawVelocityMps: velocityMps,
      };
      this.sampleCallbacks.forEach((cb) => cb(sample));
    }, intervalMs);
  }

  async stopStreaming(): Promise<void> {
    this.streaming = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async disconnect(): Promise<void> {
    await this.stopStreaming();
    this.connected = false;
    this.diag.setState("연결 끊김");
    this.disconnectCallbacks.forEach((cb) => cb());
  }
}
