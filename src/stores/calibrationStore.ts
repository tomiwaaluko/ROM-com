import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ROMProfile {
  maxFlexion: number;
  maxExtension: number;
  maxAbduction: number;
}

interface CalibrationState {
  // ROM profile from calibration
  romProfile: ROMProfile | null;
  isRecognized: boolean;
  liveAngle: number;
  calibrationComplete: boolean;

  // Actions
  setROMProfile: (profile: ROMProfile) => void;
  setRecognized: (recognized: boolean) => void;
  updateLiveAngle: (angle: number) => void;
  resetCalibration: () => void;
}

export const useCalibrationStore = create<CalibrationState>()(
  persist(
    (set) => ({
      romProfile: null,
      isRecognized: false,
      liveAngle: 0,
      calibrationComplete: false,

      setROMProfile: (profile) =>
        set({ romProfile: profile, calibrationComplete: true }),

      setRecognized: (recognized) => set({ isRecognized: recognized }),

      updateLiveAngle: (angle) => set({ liveAngle: angle }),

      resetCalibration: () =>
        set({
          romProfile: null,
          isRecognized: false,
          liveAngle: 0,
          calibrationComplete: false,
        }),
    }),
    {
      name: 'kinetic-calibration',
      partialize: (state) => ({
        romProfile: state.romProfile,
        calibrationComplete: state.calibrationComplete,
      }),
    }
  )
);
