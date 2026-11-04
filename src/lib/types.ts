// Mirrors the serialized types in src-tauri/src/myo.

export type Pose =
  | "rest"
  | "fist"
  | "waveIn"
  | "waveOut"
  | "fingersSpread"
  | "doubleTap"
  | "unknown";

export type Arm = "right" | "left" | "unknown";
export type XDirection = "towardWrist" | "towardElbow" | "unknown";
export type Sku = "unknown" | "black" | "white";
export type HardwareRev = "unknown" | "revC" | "revD";

export interface MyoInfo {
  serialNumber: number[];
  unlockPose: Pose;
  activeClassifierType: number;
  activeClassifierIndex: number;
  hasCustomClassifier: boolean;
  streamIndicating: boolean;
  sku: Sku;
}

export interface FirmwareVersion {
  major: number;
  minor: number;
  patch: number;
  hardwareRev: HardwareRev;
}

export interface DeviceDetails {
  name: string;
  info: MyoInfo;
  firmware: FirmwareVersion;
  firmwareOutdated: boolean;
  battery: number;
}

export interface DiscoveredDevice {
  id: string;
  name: string;
  rssi: number | null;
}

export type ClassifierEvent =
  | { type: "armSynced"; arm: Arm; xDirection: XDirection }
  | { type: "armUnsynced" }
  | { type: "pose"; pose: Pose }
  | { type: "unlocked" }
  | { type: "locked" }
  | { type: "syncFailed"; result: number }
  | { type: "unknown"; rawType: number };

export type MotionEvent =
  | { type: "tap"; direction: number; count: number }
  | { type: "unknown"; rawType: number };

export type SessionEvent =
  | { kind: "classifier"; event: ClassifierEvent }
  | { kind: "motion"; event: MotionEvent }
  | { kind: "battery"; level: number }
  | { kind: "rssi"; value: number }
  | { kind: "reconnecting" }
  | { kind: "reconnected" }
  | { kind: "mark"; label: string }
  | { kind: "disconnected" };

export const EMG_CHANNELS = 8;
export const EMG_RATE_HZ = 200;
export const IMU_RATE_HZ = 50;
/** Orientation (w, x, y, z), accelerometer (x, y, z) and gyroscope (x, y, z). */
export const IMU_FIELDS = 10;
