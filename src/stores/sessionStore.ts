import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface FMAScore {
  domain_a: number;
  domain_c: number;
  domain_e: number;
  total: number;
}

export interface SessionRecord {
  session_id: string;
  timestamp: number;
  exercises_completed: string[];
  fma_score: FMAScore;
}

interface SessionState {
  // Current scores
  fmaScore: FMAScore;
  streak: number;
  lastSessionDate: string | null;
  sessionHistory: SessionRecord[];

  // Actions
  updateFMAScore: (score: Record<string, number>) => void;
  completeSession: (data: Record<string, unknown>) => void;
  resetSession: () => void;
}

const DEFAULT_FMA: FMAScore = { domain_a: 0, domain_c: 0, domain_e: 0, total: 0 };

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      fmaScore: { ...DEFAULT_FMA },
      streak: 0,
      lastSessionDate: null,
      sessionHistory: [],

      updateFMAScore: (score) =>
        set({
          fmaScore: {
            domain_a: score.domain_a ?? get().fmaScore.domain_a,
            domain_c: score.domain_c ?? get().fmaScore.domain_c,
            domain_e: score.domain_e ?? get().fmaScore.domain_e,
            total: score.total ?? get().fmaScore.total,
          },
        }),

      completeSession: (data) => {
        const now = new Date();
        const today = now.toISOString().split('T')[0];
        const { lastSessionDate, streak, sessionHistory, fmaScore } = get();

        // Calculate streak: if last session was yesterday, increment; otherwise reset to 1
        let newStreak = 1;
        if (lastSessionDate) {
          const lastDate = new Date(lastSessionDate);
          const diffDays = Math.floor((now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays === 1) newStreak = streak + 1;
          else if (diffDays === 0) newStreak = streak; // same day
        }

        const record: SessionRecord = {
          session_id: (data.session_id as string) || `session_${Date.now()}`,
          timestamp: Date.now(),
          exercises_completed: (data.exercises_completed as string[]) || [],
          fma_score: { ...fmaScore },
        };

        set({
          streak: newStreak,
          lastSessionDate: today,
          sessionHistory: [...sessionHistory, record].slice(-50), // keep last 50
        });
      },

      resetSession: () =>
        set({
          fmaScore: { ...DEFAULT_FMA },
          streak: 0,
          lastSessionDate: null,
          sessionHistory: [],
        }),
    }),
    {
      name: 'kinetic-session',
    }
  )
);
