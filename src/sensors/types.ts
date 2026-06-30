/**
 * Shared sensor types for the uniform-motion experiment.
 *
 * Scientific naming is deliberate (see docs/PASCO_MOTION_EXPERIMENT_NOTES.md):
 *  - rawPositionM      : 센서로부터의 거리 (m). What the ultrasonic sensor measures.
 *  - movementDistanceCm: 처음 위치로부터 이동 거리 (cm). What the lesson graphs.
 *  - rawVelocityMps    : signed velocity from the sensor (m/s), teacher-only.
 *  - speedCmps         : 속력 (cm/s) = |velocity| * 100, the student graph.
 */

export type ExperimentDirection = "away" | "toward" | "auto";
export type VelocitySource = "sensor" | "derived";

/** A raw, minimally-processed reading straight from an adapter. */
export interface RawMotionSample {
  /** Wall-clock timestamp in ms (performance.now based). */
  timestampMs: number;
  /** Distance from the sensor to the object, in meters. */
  rawPositionM: number;
  /** Signed velocity from the sensor in m/s, or null if not provided. */
  rawVelocityMps: number | null;
}

/** A fully-processed sample used by graphs, tables and analysis. */
export interface MotionSample {
  timestampMs: number;
  /** Seconds since motion start (t = 0). */
  elapsedTimeS: number;
  rawPositionM: number;
  rawVelocityMps: number | null;
  /** Distance travelled from the starting point, in cm (always >= 0 for one-direction motion). */
  movementDistanceCm: number;
  /** Non-negative speed in cm/s. */
  speedCmps: number;
  /** False when the underlying reading was rejected as invalid/out-of-range. */
  positionValid: boolean;
  /** Whether speed came from the sensor or was derived from position. */
  velocitySource: VelocitySource;
}

export interface MotionStreamingOptions {
  /** Target polling rate in Hz (real adapter polls one-shot reads at this rate). */
  sampleRateHz: number;
}

export interface MotionSensorConnectionInfo {
  deviceName: string;
  sensorId: string;
  interfaceId: number | null;
  /** Measurement names discovered after initialization. */
  availableMeasurements: string[];
  /** True once at least one physically-plausible position value was received. */
  hasValidPosition: boolean;
}

export interface MotionSensorDiagnostics {
  deviceName: string | null;
  parsedSensorId: string | null;
  interfaceId: number | null;
  connectionState: string;
  services: string[];
  characteristics: { uuid: string; properties: string[] }[];
  channels: string[];
  measurementNames: string[];
  units: string[];
  currentRawPositionM: number | null;
  currentRawVelocityMps: number | null;
  lastRawPacketHex: string | null;
  decodedValues: Record<string, number | null>;
  velocitySource: VelocitySource | null;
  lastSampleTimeMs: number | null;
  lastError: string | null;
  /** Human-readable connection timeline entries. */
  timeline: { timeMs: number; message: string }[];
  /** Optional captured raw packets (hex) when packet logging is enabled. */
  packetLog?: string[];
  isDemo: boolean;
}

/** Sensor-independent adapter contract. */
export interface MotionSensorAdapter {
  connect(): Promise<MotionSensorConnectionInfo>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  getAvailableMeasurements(): string[];

  readPosition(): Promise<number>;
  readVelocity(): Promise<number | null>;

  startStreaming(options: MotionStreamingOptions): Promise<void>;
  stopStreaming(): Promise<void>;

  onSample(callback: (sample: RawMotionSample) => void): () => void;
  onDisconnect(callback: () => void): () => void;

  getDiagnostics(): MotionSensorDiagnostics;
}
