import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { error as logError } from "@tauri-apps/plugin-log";
import { create } from "zustand";
import { useRecordingsStore } from "./recordings";
import {
  startBatteryTrend,
  updateBatteryTrend,
  type BatteryTrend,
} from "../lib/battery";
import type { Quaternion } from "../lib/quaternion";
import type { VibrationStep } from "../lib/vibration";
import {
  ingestAnalysis,
  ingestFrame,
  logEvent,
  resetStream,
  setStreamFrozen,
} from "../lib/stream";
import type {
  Arm,
  ClassifierEvent,
  XDirection,
  DeviceDetails,
  DiscoveredDevice,
  Pose,
  SessionEvent,
} from "../lib/types";

export type ConnectionStatus =
  "disconnected" | "connecting" | "connected" | "reconnecting";

export type EmgModeSetting = "none" | "filtered" | "raw";
export type ImuModeSetting = "none" | "data" | "events" | "all" | "raw";
export type ClassifierModeSetting = "disabled" | "enabled";
export type SleepModeSetting = "normal" | "neverSleep";

/** Mirrors `StreamModes` in src-tauri/src/myo/device.rs, including its defaults. */
export interface StreamModes {
  emg: EmgModeSetting;
  imu: ImuModeSetting;
  classifier: ClassifierModeSetting;
}

const BACKEND_ERRORS = [
  "alreadyConnected",
  "deviceDisconnected",
  "adapterNotFound",
  "bluetoothOff",
  "bluetoothUnavailable",
  "permissionDenied",
  "deviceNotFound",
  "connectionTimedOut",
  "notAMyo",
  "bluetoothError",
  "invalidPattern",
  "recordingFailed",
  "notRecording",
  "alreadyRecording",
] as const;

/** Every error code has a translation under `errors.` in the i18n resources. */
export type ErrorCode =
  (typeof BACKEND_ERRORS)[number] | "desktopOnly" | "unknown";

export type SessionSource = "device" | "playback";

interface SessionState {
  status: ConnectionStatus;
  /** What the current session is connected to. */
  source: SessionSource;
  details: DeviceDetails | null;
  battery: number | null;
  batteryTrend: BatteryTrend | null;
  rssi: number | null;
  pose: Pose | null;
  arm: Arm | null;
  xDirection: XDirection | null;
  locked: boolean | null;
  tapCount: number;
  syncFailed: boolean;
  modes: StreamModes;
  sleepMode: SleepModeSetting;
  paused: boolean;
  /** Set by the user for this session, overriding the calibrated reference posture. */
  zeroOverride: Quaternion | null;
  scanning: boolean;
  /** `null` until the first scan finishes. */
  devices: DiscoveredDevice[] | null;
  errorCode: ErrorCode | null;
  togglePaused: () => void;
  vibrate: (vibration: "short" | "medium" | "long") => Promise<void>;
  playPattern: (steps: VibrationStep[]) => Promise<void>;
  setModes: (modes: StreamModes) => Promise<void>;
  unlock: (kind: "lock" | "timed" | "hold") => Promise<void>;
  setSleepMode: (sleep: SleepModeSetting) => Promise<void>;
  deepSleep: () => Promise<void>;
  setLeds: (
    logo: [number, number, number],
    line: [number, number, number],
  ) => Promise<void>;
  setZeroOverride: (zero: Quaternion) => void;
  scan: () => Promise<void>;
  connectDevice: (device: DiscoveredDevice) => Promise<void>;
  connectSimulated: () => Promise<void>;
  openRecording: (id: string) => Promise<void>;
  prepareForSeek: () => void;
  disconnect: () => Promise<void>;
  releaseStaleSession: () => Promise<void>;
}

const IDLE = {
  status: "disconnected",
  source: "device" as SessionSource,
  details: null,
  battery: null,
  batteryTrend: null,
  rssi: null,
  pose: null,
  arm: null,
  xDirection: null,
  locked: null,
  tapCount: 0,
  syncFailed: false,
  modes: { emg: "filtered", imu: "all", classifier: "enabled" } as StreamModes,
  sleepMode: "neverSleep" as SleepModeSetting,
  paused: false,
  zeroOverride: null,
} as const;

function classifierPatch(
  event: ClassifierEvent,
): Partial<SessionState> | undefined {
  switch (event.type) {
    case "armSynced":
      return {
        arm: event.arm,
        xDirection: event.xDirection,
        syncFailed: false,
      };
    case "armUnsynced":
      return { arm: null, xDirection: null };
    case "syncFailed":
      return { syncFailed: true };
    case "pose":
      return { pose: event.pose };
    case "unlocked":
      return { locked: false };
    case "locked":
      return { locked: true };
    default:
      return undefined;
  }
}

function toErrorCode(error: unknown): ErrorCode {
  const known = BACKEND_ERRORS.find((code) => code === error);
  if (known) {
    return known;
  }
  void logError(`Unexpected session error: ${String(error)}`);
  return "unknown";
}

export const useSessionStore = create<SessionState>((set, get) => {
  const onEvent = (event: SessionEvent) => {
    logEvent(event);
    switch (event.kind) {
      case "classifier": {
        const patch = classifierPatch(event.event);
        if (patch) {
          set(patch);
        }
        break;
      }
      case "battery":
        set((state) => ({
          battery: event.level,
          batteryTrend: state.batteryTrend
            ? updateBatteryTrend(state.batteryTrend, event.level)
            : startBatteryTrend(event.level),
        }));
        break;
      case "rssi":
        set({ rssi: event.value });
        break;
      case "reconnecting":
        set({ status: "reconnecting" });
        break;
      case "reconnected":
        set({ status: "connected" });
        break;
      case "disconnected":
        set({ errorCode: "deviceDisconnected" });
        void get().disconnect();
        break;
      case "mark":
        break;
      case "motion":
        if (event.event.type === "tap") {
          set((state) => ({ tapCount: state.tapCount + 1 }));
        }
        break;
    }
  };

  /** Runs a command on the current session, reporting whether it worked. */
  const run = async (
    command: string,
    args: Record<string, unknown> = {},
  ): Promise<boolean> => {
    try {
      await invoke(command, args);
      set({ errorCode: null });
      return true;
    } catch (error) {
      set({ errorCode: toErrorCode(error) });
      return false;
    }
  };

  const openSession = async (
    command: string,
    args: Record<string, unknown> = {},
    source: SessionSource = "device",
  ) => {
    if (!isTauri()) {
      set({ errorCode: "desktopOnly" });
      return;
    }
    if (get().status !== "disconnected") {
      return;
    }

    set({ status: "connecting", source, errorCode: null });
    resetStream();

    try {
      const details = await invoke<DeviceDetails>(command, {
        ...args,
        frames: new Channel<ArrayBuffer>(ingestFrame),
        analysis: new Channel<ArrayBuffer>(ingestAnalysis),
        events: new Channel<SessionEvent>(onEvent),
      });
      set({
        status: "connected",
        details,
        battery: details.battery,
        batteryTrend: startBatteryTrend(details.battery),
      });
    } catch (error) {
      set({ ...IDLE, errorCode: toErrorCode(error) });
    }
  };

  return {
    ...IDLE,
    scanning: false,
    devices: null,
    errorCode: null,

    togglePaused: () => {
      const paused = !get().paused;
      setStreamFrozen(paused);
      set({ paused });
    },

    setZeroOverride: (zeroOverride) => set({ zeroOverride }),

    vibrate: async (vibration) => {
      await run("vibrate", { vibration });
    },

    playPattern: async (steps) => {
      await run("vibrate_pattern", { steps });
    },

    setModes: async (modes) => {
      if (await run("set_stream_modes", { modes })) {
        set({ modes });
      }
    },

    unlock: async (kind) => {
      await run("unlock", { unlock: kind });
    },

    setSleepMode: async (sleep) => {
      if (await run("set_sleep_mode", { sleep })) {
        set({ sleepMode: sleep });
      }
    },

    setLeds: async (logo, line) => {
      await run("set_leds", { logo, line });
    },

    deepSleep: async () => {
      if (await run("deep_sleep")) {
        resetStream();
        set(IDLE);
        useRecordingsStore.getState().sessionEnded();
      }
    },

    scan: async () => {
      if (!isTauri()) {
        set({ errorCode: "desktopOnly" });
        return;
      }
      set({ scanning: true, errorCode: null });
      try {
        const devices = await invoke<DiscoveredDevice[]>("scan_devices");
        set({ devices, scanning: false });
      } catch (error) {
        set({ scanning: false, errorCode: toErrorCode(error) });
      }
    },

    connectDevice: (device) =>
      openSession("connect_device", { id: device.id, name: device.name }),

    connectSimulated: () => openSession("connect_simulated"),

    openRecording: (id) => openSession("open_recording", { id }, "playback"),

    /** Clears what jumping elsewhere in a recording makes outdated. */
    prepareForSeek: () => {
      resetStream();
      set({
        pose: null,
        arm: null,
        xDirection: null,
        locked: null,
        tapCount: 0,
        paused: false,
      });
    },

    disconnect: async () => {
      try {
        await invoke("disconnect");
      } catch (error) {
        set({ errorCode: toErrorCode(error) });
      }
      resetStream();
      set(IDLE);
      useRecordingsStore.getState().sessionEnded();
    },

    /**
     * A frontend reload leaves the backend session running with channels that nobody
     * listens to, so the app ends any such session when it starts.
     */
    releaseStaleSession: async () => {
      if (isTauri()) {
        await get().disconnect();
      }
    },
  };
});
