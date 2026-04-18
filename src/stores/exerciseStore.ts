import { create } from 'zustand';

export type ExerciseType =
  | 'target_reach'
  | 'trajectory_trace'
  | 'mirror_therapy'
  | 'forearm_rotation'
  | 'bimanual'
  | null;

export interface Target {
  x: number;
  y: number;
  z: number;
}

export interface ExerciseScoreEvent {
  target_hit: string;
  accuracy: number;
}

export type PoseLandmark = [number, number, number];

interface ExerciseState {
  // Current exercise
  currentExercise: ExerciseType;
  targets: Target[];
  score: number;
  accuracy: number;
  normalizedAngle: number;
  leftNormalizedAngle: number;
  forearmPronationRange: number;
  landmarks: PoseLandmark[];
  lastTargetHit: string | null;
  isActive: boolean;

  // Actions
  startExercise: (type: ExerciseType) => void;
  endExercise: () => void;
  updateTargets: (targets: Target[]) => void;
  updateScore: (score: number | ExerciseScoreEvent, accuracy?: number) => void;
  updateNormalizedAngle: (angle: number) => void;
  updateMotionFeatures: (features: Record<string, number | PoseLandmark[] | undefined>) => void;
  reset: () => void;
}

export const useExerciseStore = create<ExerciseState>((set) => ({
  currentExercise: null,
  targets: [],
  score: 0,
  accuracy: 0,
  normalizedAngle: 0,
  leftNormalizedAngle: 0,
  forearmPronationRange: 0,
  landmarks: [],
  lastTargetHit: null,
  isActive: false,

  startExercise: (type) =>
    set({
      currentExercise: type,
      isActive: true,
      score: 0,
      accuracy: 0,
      normalizedAngle: 0,
      leftNormalizedAngle: 0,
      forearmPronationRange: 0,
      landmarks: [],
      lastTargetHit: null,
      targets: [],
    }),

  endExercise: () =>
    set({ isActive: false }),

  updateTargets: (targets) => set({ targets }),

  updateScore: (score, accuracy = 0) => {
    if (typeof score === 'number') {
      set({ score, accuracy });
      return;
    }

    set((state) => ({
      score: score.target_hit ? state.score + 1 : state.score,
      accuracy: score.accuracy,
      lastTargetHit: score.target_hit,
    }));
  },

  updateNormalizedAngle: (angle) =>
    set({
      normalizedAngle: angle,
      forearmPronationRange: angle,
    }),

  updateMotionFeatures: (features) =>
    set((state) => ({
      normalizedAngle:
        typeof features.shoulder_flexion_r === 'number'
          ? features.shoulder_flexion_r
          : state.normalizedAngle,
      leftNormalizedAngle:
        typeof features.shoulder_flexion_l === 'number'
          ? features.shoulder_flexion_l
          : state.leftNormalizedAngle,
      forearmPronationRange:
        typeof features.forearm_pronation_r_range === 'number'
          ? features.forearm_pronation_r_range
          : state.forearmPronationRange,
      landmarks: Array.isArray(features.landmarks)
        ? features.landmarks
        : state.landmarks,
    })),

  reset: () =>
    set({
      currentExercise: null,
      targets: [],
      score: 0,
      accuracy: 0,
      normalizedAngle: 0,
      leftNormalizedAngle: 0,
      forearmPronationRange: 0,
      landmarks: [],
      lastTargetHit: null,
      isActive: false,
    }),
}));
