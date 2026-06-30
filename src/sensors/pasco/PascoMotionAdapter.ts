/**
 * Web Bluetooth adapter for the PASCO Wireless Motion Sensor (PS-3219).
 *
 * Honest support policy (see acceptance criteria §2 and §23):
 *  - `connect()` only resolves with hasValidPosition=true after at least one
 *    physically-plausible position value has actually been decoded.
 *  - No synthetic data is ever produced here. If decoding fails, the caller is
 *    told and the diagnostic panel exposes the raw packets for a second
 *    hardware-debugging iteration.
 */

import type {
  MotionSensorAdapter,
  MotionSensorConnectionInfo,
  MotionSensorDiagnostics,
  MotionStreamingOptions,
  RawMotionSample,
} from "../types";
import { isPlausiblePositionM } from "../motion/motionDataProcessing";
import {
  OPERATIONS_SERVICE_UUID,
  RECV_CMD_CHAR_UUID,
  SEND_CMD_CHAR_UUID,
  parsePascoName,
} from "./pascoBluetoothConstants";
import { DiagnosticsCollector } from "./pascoDiagnostics";
import {
  bytesToHex,
  decodeChannelPayload,
  parseNotification,
} from "./pascoPacketDecoder";
import {
  MOTION_CHANNEL_LAYOUT,
  buildReadOneSampleCommand,
  pickMeasurement,
} from "./pascoProtocol";

const CONNECT_TIMEOUT_MS = 15000;
const FIRST_SAMPLE_TIMEOUT_MS = 6000;

export class PascoMotionAdapter implements MotionSensorAdapter {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private sendChar: BluetoothRemoteGATTCharacteristic | null = null;
  private recvChar: BluetoothRemoteGATTCharacteristic | null = null;

  private diag = new DiagnosticsCollector(false);
  private connected = false;
  private streaming = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;

  private sampleCallbacks = new Set<(s: RawMotionSample) => void>();
  private disconnectCallbacks = new Set<() => void>();
  private pendingResolve: ((payload: Uint8Array) => void) | null = null;

  static isSupported(): boolean {
    return typeof navigator !== "undefined" && !!navigator.bluetooth;
  }

  static isSecureContext(): boolean {
    return typeof window !== "undefined" && window.isSecureContext === true;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getAvailableMeasurements(): string[] {
    return MOTION_CHANNEL_LAYOUT.measurements.map((m) => m.name);
  }

  getDiagnostics(): MotionSensorDiagnostics {
    return this.diag.snapshot();
  }

  startPacketLog(): void {
    this.diag.startPacketLog();
  }

  stopPacketLog(): void {
    this.diag.stopPacketLog();
  }

  onSample(callback: (s: RawMotionSample) => void): () => void {
    this.sampleCallbacks.add(callback);
    return () => this.sampleCallbacks.delete(callback);
  }

  onDisconnect(callback: () => void): () => void {
    this.disconnectCallbacks.add(callback);
    return () => this.disconnectCallbacks.delete(callback);
  }

  async connect(): Promise<MotionSensorConnectionInfo> {
    if (this.connected) throw new Error("이미 센서에 연결되어 있습니다.");
    if (!PascoMotionAdapter.isSupported()) {
      this.diag.setError("이 브라우저는 Web Bluetooth를 지원하지 않습니다.");
      throw new Error("지원하지 않는 브라우저");
    }
    if (!PascoMotionAdapter.isSecureContext()) {
      this.diag.setError("HTTPS(보안 연결)에서만 센서를 연결할 수 있습니다.");
      throw new Error("HTTPS 연결 필요");
    }

    try {
      this.diag.setState("기기 선택 중");
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [OPERATIONS_SERVICE_UUID] }, { namePrefix: "Motion" }],
        optionalServices: [OPERATIONS_SERVICE_UUID],
      });

      const parsed = parsePascoName(this.device.name ?? "");
      this.diag.setDevice(this.device.name ?? null, parsed.serialId, parsed.interfaceId);
      this.device.addEventListener("gattserverdisconnected", this.handleDisconnect);

      this.diag.setState("Bluetooth 연결 중");
      this.server = await withTimeout(
        this.device.gatt!.connect(),
        CONNECT_TIMEOUT_MS,
        "GATT 연결 시간 초과",
      );

      this.diag.setState("센서 정보 확인 중");
      const service = await this.server.getPrimaryService(OPERATIONS_SERVICE_UUID);
      this.diag.setServices([OPERATIONS_SERVICE_UUID]);

      this.sendChar = await service.getCharacteristic(SEND_CMD_CHAR_UUID);
      this.recvChar = await service.getCharacteristic(RECV_CMD_CHAR_UUID);
      this.diag.addCharacteristic(SEND_CMD_CHAR_UUID, ["write"]);
      this.diag.addCharacteristic(RECV_CMD_CHAR_UUID, ["notify"]);

      this.diag.setState("측정 항목 확인 중");
      this.diag.setMeasurements(
        [MOTION_CHANNEL_LAYOUT.channelName],
        MOTION_CHANNEL_LAYOUT.measurements.map((m) => m.name),
        MOTION_CHANNEL_LAYOUT.measurements.map((m) => m.unit),
      );

      await this.recvChar.startNotifications();
      this.recvChar.addEventListener(
        "characteristicvaluechanged",
        this.handleNotification,
      );

      this.diag.setState("첫 위치 자료 확인 중");
      const firstPosition = await this.readFirstValidPosition();

      this.connected = true;
      this.diag.setState("연결 완료");
      return {
        deviceName: this.device.name ?? "PASCO Motion",
        sensorId: parsed.serialId ?? "",
        interfaceId: parsed.interfaceId,
        availableMeasurements: this.getAvailableMeasurements(),
        hasValidPosition: isPlausiblePositionM(firstPosition),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.diag.setError(message);
      if (message.includes("cancelled") || message.includes("User cancelled")) {
        this.diag.setState("연결되지 않음");
      } else {
        this.diag.setState("측정값 해석 오류");
      }
      await this.cleanup();
      throw err;
    }
  }

  /** Polls one-shot reads until a physically-plausible position is decoded. */
  private async readFirstValidPosition(): Promise<number> {
    const deadline = Date.now() + FIRST_SAMPLE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const payload = await this.requestOneSample();
      const decoded = decodeChannelPayload(payload, MOTION_CHANNEL_LAYOUT);
      const hex = bytesToHex(payload);
      const position = pickMeasurement(decoded, "Position");
      const velocity = pickMeasurement(decoded, "Velocity");
      this.diag.recordSample(
        position,
        velocity,
        payload,
        Object.fromEntries(decoded.map((d) => [d.name, d.value])),
        "sensor",
        hex,
      );
      if (position !== null && isPlausiblePositionM(position)) {
        return position;
      }
    }
    throw new Error(
      "센서에는 연결했지만 위치 또는 속력 자료를 해석하지 못했습니다. 교사용 PASCO 연결 진단을 확인해 주세요.",
    );
  }

  /** Sends a one-shot read and awaits the matching response payload. */
  private async requestOneSample(): Promise<Uint8Array> {
    if (!this.sendChar) throw new Error("명령 특성을 찾을 수 없습니다.");
    if (this.inFlight) throw new Error("이전 측정 요청이 아직 끝나지 않았습니다.");
    this.inFlight = true;
    try {
      const payloadPromise = new Promise<Uint8Array>((resolve, reject) => {
        this.pendingResolve = resolve;
        setTimeout(() => {
          if (this.pendingResolve === resolve) {
            this.pendingResolve = null;
            reject(new Error("측정 응답 시간 초과"));
          }
        }, 2000);
      });
      const cmd = buildReadOneSampleCommand(MOTION_CHANNEL_LAYOUT);
      await this.sendChar.writeValue(cmd as unknown as BufferSource);
      return await payloadPromise;
    } finally {
      this.inFlight = false;
    }
  }

  private handleNotification = (event: Event): void => {
    const char = event.target as BluetoothRemoteGATTCharacteristic;
    const dv = char.value;
    if (!dv) return;
    const data = new Uint8Array(dv.buffer);
    const parsed = parseNotification(data);
    if (parsed.payload && this.pendingResolve) {
      const resolve = this.pendingResolve;
      this.pendingResolve = null;
      resolve(parsed.payload);
    }
  };

  async readPosition(): Promise<number> {
    const payload = await this.requestOneSample();
    const decoded = decodeChannelPayload(payload, MOTION_CHANNEL_LAYOUT);
    const position = pickMeasurement(decoded, "Position");
    if (position === null) throw new Error("위치 자료를 해석하지 못했습니다.");
    return position;
  }

  async readVelocity(): Promise<number | null> {
    const payload = await this.requestOneSample();
    const decoded = decodeChannelPayload(payload, MOTION_CHANNEL_LAYOUT);
    return pickMeasurement(decoded, "Velocity");
  }

  async startStreaming(options: MotionStreamingOptions): Promise<void> {
    if (!this.connected) throw new Error("센서가 연결되어 있지 않습니다.");
    if (this.streaming) return;
    this.streaming = true;
    const intervalMs = Math.max(20, Math.round(1000 / options.sampleRateHz));
    this.pollTimer = setInterval(async () => {
      if (this.inFlight) return; // never overlap reads
      try {
        const payload = await this.requestOneSample();
        const decoded = decodeChannelPayload(payload, MOTION_CHANNEL_LAYOUT);
        const position = pickMeasurement(decoded, "Position");
        const velocity = pickMeasurement(decoded, "Velocity");
        this.diag.recordSample(
          position,
          velocity,
          payload,
          Object.fromEntries(decoded.map((d) => [d.name, d.value])),
          velocity !== null ? "sensor" : "derived",
          bytesToHex(payload),
        );
        if (position === null) return;
        const sample: RawMotionSample = {
          timestampMs: performance.now(),
          rawPositionM: position,
          rawVelocityMps: velocity,
        };
        this.sampleCallbacks.forEach((cb) => cb(sample));
      } catch (err) {
        this.diag.setError(err instanceof Error ? err.message : String(err));
      }
    }, intervalMs);
  }

  async stopStreaming(): Promise<void> {
    this.streaming = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async disconnect(): Promise<void> {
    await this.stopStreaming();
    await this.cleanup();
    this.diag.setState("연결 끊김");
  }

  private async cleanup(): Promise<void> {
    try {
      if (this.recvChar) {
        this.recvChar.removeEventListener(
          "characteristicvaluechanged",
          this.handleNotification,
        );
        try {
          await this.recvChar.stopNotifications();
        } catch {
          /* ignore */
        }
      }
      if (this.server?.connected) this.server.disconnect();
    } finally {
      this.connected = false;
      this.streaming = false;
      this.sendChar = null;
      this.recvChar = null;
      this.server = null;
      this.pendingResolve = null;
      this.inFlight = false;
    }
  }

  private handleDisconnect = (): void => {
    this.connected = false;
    this.streaming = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.diag.setState("연결 끊김");
    this.disconnectCallbacks.forEach((cb) => cb());
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}
