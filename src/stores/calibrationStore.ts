import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type CalibrationPhase =
  | 'idle'
  | 'intro'
  | 'shoulder_flex'
  | 'shoulder_abd'
  | 'elbow'
  | 'wrist'
  | 'complete';

export const CAPTURE_PHASES: CalibrationPhase[] = [
  'shoulder_flex',
  'shoulder_abd',
  'elbow',
  'wrist',
];

export interface ROMProfile {
  maxFlexion: number;
  maxExtension: number;
  maxAbduction: number;
}

export interface UserROMEntry {
  userId: string;
  profile: ROMProfile;
  capturedAngles: Record<string, number>; // phase → max angle captured
  accentColor: string;
}

interface CalibrationState {
  // Current calibration
  phase: CalibrationPhase;
  currentUserId: string;
  romProfile: ROMProfile | null;
  isRecognized: boolean;
  liveAngle: number;
  liveAnglesByJoint: Record<string, number>;
  calibrationComplete: boolean;
  capturedAngles: Record<string, number>;

  // Multi-user profiles
  userProfiles: Record<string, UserROMEntry>;

  // Actions
  setPhase: (phase: CalibrationPhase) => void;
  nextPhase: () => void;
  setROMProfile: (profile: ROMProfile) => void;
  setRecognized: (recognized: boolean) => void;
  updateLiveAngle: (angle: number, joint?: string) => void;
  captureMaxAngle: (phase: string, angle: number) => void;
  switchUser: (userId: string) => void;
  resetCalibration: () => void;
}

const ACCENT_COLORS = ['#F6A43C', '#F26B64', '#ff6644', '#ffcc00', '#cc44ff'];

function getAccentColor(index: number): string {
  return ACCENT_COLORS[index % ACCENT_COLORS.length];
}

export const useCalibrationStore = create<CalibrationState>()(
  persist(
    (set, get) => ({
      phase: 'idle',
      currentUserId: 'user_1',
      romProfile: null,
      isRecognized: false,
      liveAngle: 0,
      liveAnglesByJoint: {},
      calibrationComplete: false,
      capturedAngles: {},
      userProfiles: {},

      setPhase: (phase) => set({ phase }),

      nextPhase: () => {
        const { phase, liveAngle, capturedAngles } = get();
        const allPhases: CalibrationPhase[] = [
          'intro',
          'shoulder_flex',
          'shoulder_abd',
          'elbow',
          'wrist',
          'complete',
        ];
        const idx = allPhases.indexOf(phase);
        if (idx < 0 || idx >= allPhases.length - 1) return;

        // If leaving a capture phase, save the max angle
        if (CAPTURE_PHASES.includes(phase)) {
          const currentMax = capturedAngles[phase] ?? 0;
          const newMax = Math.max(currentMax, liveAngle);
          set({
            capturedAngles: { ...capturedAngles, [phase]: newMax },
          });
        }

        const nextPhase = allPhases[idx + 1];

        if (nextPhase === 'complete') {
          // Build ROM profile from captured angles
          const angles = get().capturedAngles;
          const profile: ROMProfile = {
            maxFlexion: Math.round((angles['shoulder_flex'] ?? 0) * 180),
            maxExtension: Math.round((angles['elbow'] ?? 0) * 180),
            maxAbduction: Math.round((angles['shoulder_abd'] ?? 0) * 180),
          };
          const { currentUserId, userProfiles } = get();
          const entry: UserROMEntry = {
            userId: currentUserId,
            profile,
            capturedAngles: { ...get().capturedAngles },
            accentColor:
              userProfiles[currentUserId]?.accentColor ??
              getAccentColor(Object.keys(userProfiles).length),
          };
          set({
            phase: 'complete',
            romProfile: profile,
            calibrationComplete: true,
            isRecognized: true,
            userProfiles: { ...userProfiles, [currentUserId]: entry },
          });
        } else {
          set({ phase: nextPhase, liveAngle: 0 });
        }
      },

      setROMProfile: (profile) =>
        set({ romProfile: profile, calibrationComplete: true }),

      setRecognized: (recognized) => set({ isRecognized: recognized }),

      updateLiveAngle: (angle, joint) => {
        const { phase, capturedAngles, liveAnglesByJoint } = get();
        const nextLiveAnglesByJoint = joint
          ? { ...liveAnglesByJoint, [joint]: angle }
          : liveAnglesByJoint;

        // During capture phases, also track max
        if (CAPTURE_PHASES.includes(phase)) {
          const currentMax = capturedAngles[phase] ?? 0;
          if (angle > currentMax) {
            set({
              liveAngle: angle,
              liveAnglesByJoint: nextLiveAnglesByJoint,
              capturedAngles: { ...capturedAngles, [phase]: angle },
            });
            return;
          }
        }
        set({ liveAngle: angle, liveAnglesByJoint: nextLiveAnglesByJoint });
      },

      captureMaxAngle: (phase, angle) => {
        const { capturedAngles } = get();
        const currentMax = capturedAngles[phase] ?? 0;
        if (angle > currentMax) {
          set({ capturedAngles: { ...capturedAngles, [phase]: angle } });
        }
      },

      switchUser: (userId) => {
        const { userProfiles } = get();
        const existing = userProfiles[userId];
        if (existing) {
          set({
            currentUserId: userId,
            romProfile: existing.profile,
            capturedAngles: existing.capturedAngles,
            calibrationComplete: true,
            isRecognized: true,
            phase: 'complete',
            liveAngle: 0,
            liveAnglesByJoint: {},
          });
        } else {
          set({
            currentUserId: userId,
            romProfile: null,
            capturedAngles: {},
            calibrationComplete: false,
            isRecognized: false,
            phase: 'idle',
            liveAngle: 0,
            liveAnglesByJoint: {},
          });
        }
      },

      resetCalibration: () =>
        set({
          phase: 'idle',
          romProfile: null,
          isRecognized: false,
          liveAngle: 0,
          liveAnglesByJoint: {},
          calibrationComplete: false,
          capturedAngles: {},
        }),
    }),
    {
      name: 'kinetic-calibration',
      partialize: (state) => ({
        romProfile: state.romProfile,
        calibrationComplete: state.calibrationComplete,
        userProfiles: state.userProfiles,
        currentUserId: state.currentUserId,
      }),
    }
  )
);
