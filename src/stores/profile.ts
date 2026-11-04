import { invoke, isTauri } from "@tauri-apps/api/core";
import { error as logError } from "@tauri-apps/plugin-log";
import { create } from "zustand";
import type { Calibration, Placement, Profile } from "../lib/calibration";

interface ProfileState extends Profile {
  saveFailed: boolean;
  loadProfile: () => Promise<void>;
  setPlacement: (placement: Placement) => Promise<void>;
  setCalibration: (calibration: Calibration) => Promise<void>;
}

export const useProfileStore = create<ProfileState>((set, get) => {
  const persist = async () => {
    const { placement, calibration } = get();
    try {
      await invoke("save_profile", { profile: { placement, calibration } });
      set({ saveFailed: false });
    } catch (error) {
      void logError(`Could not save the profile: ${String(error)}`);
      set({ saveFailed: true });
    }
  };

  return {
    placement: null,
    calibration: null,
    saveFailed: false,

    loadProfile: async () => {
      if (isTauri()) {
        set(await invoke<Profile>("load_profile"));
      }
    },

    setPlacement: async (placement) => {
      set({ placement });
      await persist();
    },

    setCalibration: async (calibration) => {
      set({ calibration, placement: calibration.placement });
      await persist();
    },
  };
});
