import { invoke, isTauri } from "@tauri-apps/api/core";
import { error as logError } from "@tauri-apps/plugin-log";
import { create } from "zustand";
import type { TrainedGesture } from "../lib/gestures";

interface GesturesState {
  gestures: TrainedGesture[];
  saveFailed: boolean;
  load: () => Promise<void>;
  add: (name: string, illustration: TrainedGesture["illustration"]) => void;
  remove: (index: number) => void;
  setRepetitions: (index: number, repetitions: number[][][]) => void;
}

export const useGesturesStore = create<GesturesState>((set, get) => {
  const persist = async () => {
    try {
      await invoke("save_gesture_model", {
        model: { gestures: get().gestures },
      });
      set({ saveFailed: false });
    } catch (error) {
      void logError(`Could not save the gestures: ${String(error)}`);
      set({ saveFailed: true });
    }
  };

  return {
    gestures: [],
    saveFailed: false,

    load: async () => {
      if (isTauri()) {
        const model = await invoke<{ gestures: TrainedGesture[] }>(
          "load_gesture_model",
        );
        set({ gestures: model.gestures });
      }
    },

    add: (name, illustration) => {
      set((state) => ({
        gestures: [...state.gestures, { name, illustration, repetitions: [] }],
      }));
      void persist();
    },

    remove: (index) => {
      set((state) => ({
        gestures: state.gestures.filter(
          (_, gestureIndex) => gestureIndex !== index,
        ),
      }));
      void persist();
    },

    setRepetitions: (index, repetitions) => {
      set((state) => ({
        gestures: state.gestures.map((gesture, gestureIndex) =>
          gestureIndex === index ? { ...gesture, repetitions } : gesture,
        ),
      }));
      void persist();
    },
  };
});
