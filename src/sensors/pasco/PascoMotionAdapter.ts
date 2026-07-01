/**
 * Web Bluetooth adapter for the PASCO Wireless Motion Sensor (PS-3219).
 *
 * Honest support policy (see acceptance criteria §2 and §23):
 *  - `connect()` only resolves with hasValidPosition=true after at least one
 *    physically-plausible position value has actually been decoded.
 *  - No synthetic data is ever produced here. If decoding fails, the caller is
 *    told and the diagnostic panel exposes the discovered services/characteristics
 *    and raw packets for a second hardware-debugging iteration.
 *
 * Robustness (no confirmed PS-3219 layout yet):
 *  - GATT SCANNER: enumerate every authorized PASCO service and characteristic,
 *    record them to diagnostics, and operate across whichever service actually
 *    carries the sensor data. (On PASCO sensors, sensor-data characteristics live
 *    on a channel service id = sensor_id + 1, NOT operations service 0.)
 *  - Accept BOTH one-shot responses and auto-streamed periodic packets.
 *  - Decode position by scanning the raw packet for a plausible-position float at
 *    any offset; derive speed from position (velocity field not yet confirmed).
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
  RECV_CMD_SEGMENT,
  SEND_CMD_SEGMENT,
  candidateServiceUuids,
  charIdSegment,
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
  private sendChars: BluetoothRemoteGATTCharacteristic[] = [];
  private recvChars: BluetoothRemoteGATTCharacteristic[] = [];

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

    const serviceUuids = candidateServiceUuids();
    try {
      this.diag.setState("기기 선택 중");
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: "Motion" }, { services: [serviceUuids[0]] }],
        optionalServices: serviceUuids,
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
      await this.discoverServices();

      if (this.recvChars.length === 0) {
        throw new Error(
          "센서에서 알림(notify) 특성을 찾지 못했습니다. 교사용 PASCO 연결 진단을 확인해 주세요.",
        );
      }

      this.diag.setState("측정 항목 확인 중");
      this.diag.setMeasurements(
        [MOTION_CHANNEL_LAYOUT.channelName],
        MOTION_CHANNEL_LAYOUT.measurements.map((m) => m.name),
        MOTION_CHANNEL_LAYOUT.measurements.map((m) => m.unit),
      );

      for (const recv of this.recvChars) {
        try {
          await recv.startNotifications();
          recv.addEventListener("characteristicvaluechanged", this.handleNotification);
        } catch (e) {
          this.diag.log(`알림 시작 실패: ${recv.uuid} (${(e as Error).message})`);
        }
      }

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

  /** Enumerate every authorized service + characteristic and classify them. */
  private async discoverServices(): Promise<void> {
    if (!this.server) return;
    let services: BluetoothRemoteGATTService[] = [];
    try {
      services = await this.server.getPrimaryServices();
    } catch (e) {
      this.diag.log(`서비스 목록 조회 실패: ${(e as Error).message}`);
    }
    this.diag.setServices(services.map((s) => s.uuid));
    this.diag.log(`발견한 서비스 ${services.length}개`);

    const sendByExact: BluetoothRemoteGATTCharacteristic[] = [];
    const recvByExact: BluetoothRemoteGATTCharacteristic[] = [];
    const sendWritable: BluetoothRemoteGATTCharacteristic[] = [];
    const recvNotify: BluetoothRemoteGATTCharacteristic[] = [];

    for (const service of services) {
      let chars: BluetoothRemoteGATTCharacteristic[] = [];
      try {
        chars = await service.getCharacteristics();
      } catch (e) {
        this.diag.log(`특성 조회 실패: ${service.uuid} (${(e as Error).message})`);
        continue;
      }
      for (const c of chars) {
        const p = c.properties;
        const props: string[] = [];
        if (p.read) props.push("read");
        if (p.write) props.push("write");
        if (p.writeWithoutResponse) props.push("writeWithoutResponse");
        if (p.notify) props.push("notify");
        if (p.indicate) props.push("indicate");
        this.diag.addCharacteristic(c.uuid, props);

        const seg = charIdSegment(c.uuid);
        const writable = p.write || p.writeWithoutResponse;
        const notifies = p.notify || p.indicate;
        if (writable) {
          sendWritable.push(c);
          if (seg === SEND_CMD_SEGMENT) sendByExact.push(c);
        }
        if (notifies) {
          recvNotify.push(c);
          if (seg === RECV_CMD_SEGMENT) recvByExact.push(c);
        }
      }
    }

    // Prefer the official command characteristics; fall back to any matching props.
    this.sendChars = sendByExact.length ? sendByExact : sendWritable;
    this.recvChars = recvByExact.length ? recvByExact : recvNotify;
    this.diag.log(
      `명령 특성 ${this.sendChars.length}개 / 알림 특성 ${this.recvChars.length}개`,
    );
  }

  /**
   * Nudges with a one-shot read on every command characteristic and inspects
   * every incoming packet until a physically-plausible position is decoded.
   * Never throws on a single timeout — only after the overall deadline.
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

  /** Best-effort one-shot read on all command characteristics (write errors ignored). */
  private async sendOneShotNudge(): Promise<void> {
    if (this.sendChars.length === 0 || this.nudging) return;
    this.nudging = true;
    const cmd = buildReadOneSampleCommand(MOTION_CHANNEL_LAYOUT);
    try {
      for (const send of this.sendChars) {
        try {
          await send.writeValue(cmd as unknown as BufferSource);
        } catch {
          /* device may stream without one-shot commands; ignore */
        }
      }
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
      `${char.uuid.slice(0, 13)} · ${bytesToHex(data)}`,
    );

    if (this.streaming && position !== null) {
      const sample: RawMotionSample = {
        timestampMs: performance.now(),
        rawPositionM: position,
        rawVelocityMps: null, // speed derived; velocity offset not yet confirmed
      };
      this.sampleCallbacks.forEach((cb) => cb(sample));
    }

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
      for (const recv of this.recvChars) {
        recv.removeEventListener("characteristicvaluechanged", this.handleNotification);
        try {
          await recv.stopNotifications();
        } catch {
          /* ignore */
        }
      }
      if (this.server?.connected) this.server.disconnect();
    } finally {
      this.connected = false;
      this.streaming = false;
      this.sendChars = [];
      this.recvChars = [];
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
