import { create } from 'zustand';

export type ExerciseType = 'target_reach' | 'trajectory_trace' | null;

export interface Target {
  x: number;
  y: number;
  z: number;
}

interface ExerciseState {
  // Current exercise
  currentExercise: ExerciseType;
  targets: Target[];
  score: number;
  accuracy: number;
  normalizedAngle: number;
  isActive: boolean;

  // Actions
  startExercise: (type: ExerciseType) => void;
  endExercise: () => void;
  updateTargets: (targets: Target[]) => void;
  updateScore: (score: number, accuracy: number) => void;
  updateNormalizedAngle: (angle: number) => void;
  reset: () => void;
}

export const useExerciseStore = create<ExerciseState>((set) => ({
  currentExercise: null,
  targets: [],
  score: 0,
  accuracy: 0,
  normalizedAngle: 0,
  isActive: false,

  startExercise: (type) =>
    set({ currentExercise: type, isActive: true, score: 0, accuracy: 0, normalizedAngle: 0, targets: [] }),

  endExercise: () =>
    set({ isActive: false }),

  updateTargets: (targets) => set({ targets }),

  updateScore: (score, accuracy) => set({ score, accuracy }),

  updateNormalizedAngle: (angle) => set({ normalizedAngle: angle }),

  reset: () =>
    set({ currentExercise: null, targets: [], score: 0, accuracy: 0, normalizedAngle: 0, isActive: false }),
}));
