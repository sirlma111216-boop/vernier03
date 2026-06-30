/**
 * Web Bluetooth adapter for the PASCO Wireless Motion Sensor (PS-3219).
 *
 * Honest support policy (see acceptance criteria §2 and §23):
 *  - `connect()` only resolves with hasValidPosition=true after at least one
 *    physically-plausible position value has actually been decoded.
 *  - No synthetic data is ever produced here. If decoding fails, the caller is
 *    told and the diagnostic panel exposes the raw packets for a second
 *    hardware-debugging iteration.
 *
 * Layout robustness: the exact PS-3219 channel byte-layout is not yet
 * hardware-confirmed, and the device may either reply to one-shot reads or
 * stream periodic packets. So we (a) nudge with a one-shot read command AND
 * accept auto-streamed packets, and (b) decode position by scanning the raw
 * packet for a plausible-position float at any offset. Speed is DERIVED from
 * the position signal (the velocity field offset is not yet confirmed); the
 * decoded velocity candidate is still recorded in diagnostics.
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
import { bytesToHex, scanMotionFromRaw } from "./pascoPacketDecoder";
import { MOTION_CHANNEL_LAYOUT, buildReadOneSampleCommand } from "./pascoProtocol";

const CONNECT_TIMEOUT_MS = 15000;
const FIRST_SAMPLE_TIMEOUT_MS = 10000;
const PACKET_WAIT_MS = 1200;

export class PascoMotionAdapter implements MotionSensorAdapter {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private sendChar: BluetoothRemoteGATTCharacteristic | null = null;
  private recvChar: BluetoothRemoteGATTCharacteristic | null = null;

  private diag = new DiagnosticsCollector(false);
  private connected = false;
  private streaming = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private nudging = false;

  private sampleCallbacks = new Set<(s: RawMotionSample) => void>();
  private disconnectCallbacks = new Set<() => void>();
  private packetWaiters: ((data: Uint8Array) => void)[] = [];
  private lastRaw: Uint8Array | null = null;

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
      if (message.toLowerCase().includes("cancel") || message.includes("취소")) {
        this.diag.setState("연결되지 않음");
      } else {
        this.diag.setState("측정값 해석 오류");
      }
      await this.cleanup();
      throw err;
    }
  }

  /**
   * Repeatedly nudges with a one-shot read and inspects every incoming packet
   * (one-shot response OR auto-stream) until a physically-plausible position is
   * decoded. Never throws on a single timeout — only after the overall deadline.
   */
  private async readFirstValidPosition(): Promise<number> {
    const deadline = Date.now() + FIRST_SAMPLE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await this.sendOneShotNudge();
      let data: Uint8Array | null = null;
      try {
        data = await this.waitNextPacket(PACKET_WAIT_MS);
      } catch {
        data = this.lastRaw;
      }
      if (data) {
        const pos = scanMotionFromRaw(data)?.positionM ?? null;
        if (pos !== null && isPlausiblePositionM(pos)) return pos;
      }
    }
    throw new Error(
      "센서에는 연결했지만 위치 또는 속력 자료를 해석하지 못했습니다. 교사용 PASCO 연결 진단을 확인해 주세요.",
    );
  }

  /** Best-effort one-shot read command. Ignores write errors (device may auto-stream). */
  private async sendOneShotNudge(): Promise<void> {
    if (!this.sendChar || this.nudging) return;
    this.nudging = true;
    try {
      const cmd = buildReadOneSampleCommand(MOTION_CHANNEL_LAYOUT);
      await this.sendChar.writeValue(cmd as unknown as BufferSource);
    } catch {
      /* device may stream without one-shot commands; ignore */
    } finally {
      this.nudging = false;
    }
  }

  /** Resolves with the next raw notification packet, or rejects on timeout. */
  private waitNextPacket(timeoutMs: number): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const onPacket = (d: Uint8Array): void => {
        clearTimeout(timer);
        resolve(d);
      };
      const timer = setTimeout(() => {
        this.packetWaiters = this.packetWaiters.filter((w) => w !== onPacket);
        reject(new Error("패킷 대기 시간 초과"));
      }, timeoutMs);
      this.packetWaiters.push(onPacket);
    });
  }

  private handleNotification = (event: Event): void => {
    const char = event.target as BluetoothRemoteGATTCharacteristic;
    const dv = char.value;
    if (!dv) return;
    // Copy out of the shared backing buffer.
    const data = new Uint8Array(dv.buffer.slice(dv.byteOffset, dv.byteOffset + dv.byteLength));
    this.lastRaw = data;

    const scanned = scanMotionFromRaw(data);
    const position = scanned ? scanned.positionM : null;
    this.diag.recordSample(
      position,
      scanned?.velocityCandidateMps ?? null,
      data,
      {
        Position: position,
        VelocityCandidate: scanned?.velocityCandidateMps ?? null,
        byteOffset: scanned ? scanned.positionOffset : -1,
      },
      "derived",
      bytesToHex(data),
    );

    if (this.streaming && position !== null) {
      const sample: RawMotionSample = {
        timestampMs: performance.now(),
        rawPositionM: position,
        // Speed is derived from position; the velocity field offset is not yet
        // hardware-confirmed (candidate is kept in diagnostics only).
        rawVelocityMps: null,
      };
      this.sampleCallbacks.forEach((cb) => cb(sample));
    }

    // Wake any waiters.
    const waiters = this.packetWaiters;
    this.packetWaiters = [];
    waiters.forEach((fn) => fn(data));
  };

  async readPosition(): Promise<number> {
    await this.sendOneShotNudge();
    const data = await this.waitNextPacket(2000);
    const pos = scanMotionFromRaw(data)?.positionM ?? null;
    if (pos === null) throw new Error("위치 자료를 해석하지 못했습니다.");
    return pos;
  }

  async readVelocity(): Promise<number | null> {
    await this.sendOneShotNudge();
    const data = await this.waitNextPacket(2000);
    return scanMotionFromRaw(data)?.velocityCandidateMps ?? null;
  }

  async startStreaming(options: MotionStreamingOptions): Promise<void> {
    if (!this.connected) throw new Error("센서가 연결되어 있지 않습니다.");
    if (this.streaming) return;
    this.streaming = true;
    const intervalMs = Math.max(20, Math.round(1000 / options.sampleRateHz));
    // Nudge with one-shot reads at the sample rate. Auto-streaming devices keep
    // sending packets on their own; the nudge is harmless there. Sample emission
    // happens in handleNotification.
    this.pollTimer = setInterval(() => {
      void this.sendOneShotNudge();
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
      this.packetWaiters = [];
      this.lastRaw = null;
      this.nudging = false;
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
