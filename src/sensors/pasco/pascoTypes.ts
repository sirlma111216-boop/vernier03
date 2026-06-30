/** PASCO-specific measurement and packet types. */

export type PascoMeasurementType = "Direct" | "RawDigital";

export interface PascoMeasurementSpec {
  /** NameTag from the datasheet, e.g. "Position". */
  name: string;
  /** Byte size of the field within the channel payload. */
  dataSize: number;
  type: PascoMeasurementType;
  /** Unit string, e.g. "m", "m/s". */
  unit: string;
}

/**
 * Channel layout describing the order of measurements in a one-shot payload.
 * For the Motion sensor we need Position and Velocity; their exact ordering /
 * data sizes come from the device datasheet and MUST be confirmed against real
 * hardware via the diagnostic packet log (see notes doc).
 */
export interface PascoChannelLayout {
  channelName: string;
  measurements: PascoMeasurementSpec[];
}

export interface DecodedMeasurement {
  name: string;
  value: number;
  unit: string;
}
