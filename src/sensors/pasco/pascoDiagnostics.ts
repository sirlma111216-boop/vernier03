/** Mutable diagnostics collector shared by the PASCO adapter. */

import type { MotionSensorDiagnostics, VelocitySource } from "../types";

export class DiagnosticsCollector {
  private state: MotionSensorDiagnostics;
  private startMs = Date.now();
  private packetLogging = false;

  constructor(isDemo = false) {
    this.state = {
      deviceName: null,
      parsedSensorId: null,
      interfaceId: null,
      connectionState: "연결되지 않음",
      services: [],
      characteristics: [],
      channels: [],
      measurementNames: [],
      units: [],
      currentRawPositionM: null,
      currentRawVelocityMps: null,
      lastRawPacketHex: null,
      decodedValues: {},
      velocitySource: null,
      lastSampleTimeMs: null,
      lastError: null,
      timeline: [],
      packetLog: [],
      isDemo,
    };
  }

  log(message: string): void {
    this.state.timeline.push({ timeMs: Date.now() - this.startMs, message });
  }

  setState(connectionState: string): void {
    this.state.connectionState = connectionState;
    this.log(`상태: ${connectionState}`);
  }

  setError(error: string | null): void {
    this.state.lastError = error;
    if (error) this.log(`오류: ${error}`);
  }

  setDevice(name: string | null, sensorId: string | null, interfaceId: number | null): void {
    this.state.deviceName = name;
    this.state.parsedSensorId = sensorId;
    this.state.interfaceId = interfaceId;
  }

  setServices(services: string[]): void {
    this.state.services = services;
  }

  addCharacteristic(uuid: string, properties: string[]): void {
    this.state.characteristics.push({ uuid, properties });
  }

  setMeasurements(channels: string[], names: string[], units: string[]): void {
    this.state.channels = channels;
    this.state.measurementNames = names;
    this.state.units = units;
  }

  recordSample(
    positionM: number | null,
    velocityMps: number | null,
    rawPacket: Uint8Array | null,
    decoded: Record<string, number | null>,
    velocitySource: VelocitySource | null,
    hex?: string,
  ): void {
    this.state.currentRawPositionM = positionM;
    this.state.currentRawVelocityMps = velocityMps;
    this.state.decodedValues = decoded;
    this.state.velocitySource = velocitySource;
    this.state.lastSampleTimeMs = Date.now();
    if (hex) {
      this.state.lastRawPacketHex = hex;
      if (this.packetLogging && this.state.packetLog) {
        this.state.packetLog.push(hex);
      }
    } else if (rawPacket) {
      this.state.lastRawPacketHex = Array.from(rawPacket)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" ");
    }
  }

  startPacketLog(): void {
    this.packetLogging = true;
    this.state.packetLog = [];
    this.log("원시 패킷 기록 시작");
  }

  stopPacketLog(): void {
    this.packetLogging = false;
    this.log("원시 패킷 기록 중지");
  }

  snapshot(): MotionSensorDiagnostics {
    // Deep-ish copy so the UI cannot mutate internal state.
    return JSON.parse(JSON.stringify(this.state));
  }
}
