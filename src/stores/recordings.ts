import { invoke, isTauri } from "@tauri-apps/api/core";
import { error as logError } from "@tauri-apps/plugin-log";
import { create } from "zustand";
import { logEvent } from "../lib/stream";
import { useProfileStore } from "./profile";

/** Mirrors `RecordingSummary` in src-tauri/src/myo/recorder.rs. */
export interface RecordingSummary {
  id: string;
  label: string;
  startedAtMs: number;
  durationMs: number;
  emgSamples: number;
  imuSamples: number;
  events: number;
  sizeBytes: number;
  lostEmgFraction: number | null;
  path: string;
  device: { name: string };
}

interface RecordingsState {
  recordings: RecordingSummary[];
  activeSince: number | null;
  failed: boolean;
  refresh: () => Promise<void>;
  start: (label: string) => Promise<void>;
  stop: () => Promise<void>;
  addMark: (label: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  exportJson: (id: string) => Promise<string | null>;
  /** A session ended, which also ends any recording in the backend. */
  sessionEnded: () => void;
}

export const useRecordingsStore = create<RecordingsState>((set, get) => {
  const attempt = async <T>(
    action: () => Promise<T>,
  ): Promise<T | undefined> => {
    try {
      const result = await action();
      set({ failed: false });
      return result;
    } catch (error) {
      void logError(`Recording command failed: ${String(error)}`);
      set({ failed: true });
      return undefined;
    }
  };

  return {
    recordings: [],
    activeSince: null,
    failed: false,

    refresh: async () => {
      if (!isTauri()) {
        return;
      }
      const recordings = await attempt(() =>
        invoke<RecordingSummary[]>("list_recordings"),
      );
      if (recordings) {
        set({ recordings });
      }
    },

    start: async (label) => {
      const placement = useProfileStore.getState().placement;
      const id = await attempt(() =>
        invoke<string>("start_recording", { label, placement }),
      );
      if (id) {
        set({ activeSince: Date.now() });
      }
    },

    stop: async () => {
      await attempt(() => invoke("stop_recording"));
      set({ activeSince: null });
      await get().refresh();
    },

    addMark: async (label) => {
      await attempt(() => invoke("add_mark", { label }));
      logEvent({ kind: "mark", label });
    },

    remove: async (id) => {
      await attempt(() => invoke("delete_recording", { id }));
      await get().refresh();
    },

    exportJson: async (id) =>
      (await attempt(() => invoke<string>("export_recording_json", { id }))) ??
      null,

    sessionEnded: () => {
      if (get().activeSince !== null) {
        set({ activeSince: null });
        void get().refresh();
      }
    },
  };
});
