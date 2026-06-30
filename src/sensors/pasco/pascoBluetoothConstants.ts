/**
 * PASCO BLE constants and helpers.
 *
 * All values here are derived from the official PASCO reference implementation
 * (PASCOscientific/pasco_python, src/pasco/pasco_ble_device.py). They are NOT
 * invented. See docs/PASCO_MOTION_EXPERIMENT_NOTES.md for the citation and for
 * the one documented gap (the PS-3219 measurement byte-layout, which lives in
 * an embedded per-sensor XML datasheet).
 */

// UUID pattern: "4a5c000{service}-000{characteristic}-0000-0000-5c1e741f1c00"
const UUID_SUFFIX = "-0000-0000-5c1e741f1c00";

/** Build the 128-bit UUID for a given service/characteristic id pair. */
export function pascoUuid(serviceId: number, characteristicId: number): string {
  return `4a5c000${serviceId}-000${characteristicId}${UUID_SUFFIX}`;
}

/** The base service id used for sensor operations is 0. */
export const OPERATIONS_SERVICE_ID = 0;

/** Fixed characteristic ids within a service (from the official library). */
export const SEND_CMD_CHAR_ID = 2; // host -> sensor commands
export const RECV_CMD_CHAR_ID = 3; // sensor -> host notifications
export const SEND_ACK_CHAR_ID = 5; // host -> sensor stream acknowledgements

/** The advertised 128-bit service UUID used for device discovery filtering. */
export const OPERATIONS_SERVICE_UUID = pascoUuid(OPERATIONS_SERVICE_ID, 0);
export const SEND_CMD_CHAR_UUID = pascoUuid(OPERATIONS_SERVICE_ID, SEND_CMD_CHAR_ID);
export const RECV_CMD_CHAR_UUID = pascoUuid(OPERATIONS_SERVICE_ID, RECV_CMD_CHAR_ID);
export const SEND_ACK_CHAR_UUID = pascoUuid(OPERATIONS_SERVICE_ID, SEND_ACK_CHAR_ID);

// --- Command opcodes (GCMD_*) ----------------------------------------------
export const GCMD_READ_ONE_SAMPLE = 0x05;
export const GCMD_XFER_BURST_RAM = 0x0e;
export const GCMD_CUSTOM_CMD = 0x37;

// --- Response markers ------------------------------------------------------
export const GRSP_RESULT = 0xc0; // generic command response
export const GRSP_OK = 0x00; // data[1] == 0x00 means success
/** Periodic streaming packets use a marker (data[0]) of <= 0x1F. */
export const PERIODIC_PACKET_MAX_MARKER = 0x1f;

/**
 * Parse a PASCO advertised BLE name, e.g. "Motion 1234567K".
 *  - dev type   = everything before the last space
 *  - serial id  = first 7 chars of the trailing token
 *  - interface  = base64-decoded 9th char of the trailing token + 1024
 * Mirrors `name.rsplit(' ', 1)` in the official library.
 */
export function parsePascoName(name: string): {
  deviceType: string;
  serialId: string | null;
  interfaceId: number | null;
} {
  const trimmed = (name ?? "").trim();
  const lastSpace = trimmed.lastIndexOf(" ");
  if (lastSpace < 0) {
    return { deviceType: trimmed, serialId: null, interfaceId: null };
  }
  const deviceType = trimmed.slice(0, lastSpace);
  const token = trimmed.slice(lastSpace + 1);
  const serialId = token.length >= 7 ? token.slice(0, 7) : token || null;
  let interfaceId: number | null = null;
  if (token.length >= 9) {
    const decoded = decodePascoBase64(token[8]);
    interfaceId = decoded === null ? null : decoded + 1024;
  }
  return { deviceType, serialId, interfaceId };
}

/**
 * PASCO's custom base-64-ish character map: '0'-'9' -> 0-9, then 'A'-'Z',
 * then 'a'-'z' continue the sequence. Returns null for unknown characters.
 */
export function decodePascoBase64(ch: string): number | null {
  if (!ch) return null;
  const code = ch.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48; // 0-9 -> 0..9
  if (code >= 65 && code <= 90) return code - 65 + 10; // A-Z -> 10..35
  if (code >= 97 && code <= 122) return code - 97 + 36; // a-z -> 36..61
  return null;
}
