import { create } from 'zustand';

export interface AvatarSession {
  session_id: string;
  livekit_url: string;
  livekit_client_token: string;
  ws_url?: string;
  max_session_duration: number;
}

export type AvatarStatus =
  | 'idle'
  | 'starting'
  | 'connecting'
  | 'connected'
  | 'speaking'
  | 'error'
  | 'stopped';

interface AvatarState {
  session: AvatarSession | null;
  status: AvatarStatus;
  errorMessage: string | null;
  lastAvatarText: string | null;
  lastStage: string | null;

  setSession: (session: AvatarSession | null) => void;
  setStatus: (status: AvatarStatus) => void;
  setError: (message: string | null) => void;
  setAvatarText: (text: string, stage?: string) => void;
  reset: () => void;
}

export const useAvatarStore = create<AvatarState>((set) => ({
  session: null,
  status: 'idle',
  errorMessage: null,
  lastAvatarText: null,
  lastStage: null,

  setSession: (session) => set({ session }),
  setStatus: (status) => set({ status }),
  setError: (message) => set({ errorMessage: message, status: message ? 'error' : 'idle' }),
  setAvatarText: (text, stage) =>
    set({ lastAvatarText: text, lastStage: stage ?? null }),
  reset: () =>
    set({
      session: null,
      status: 'idle',
      errorMessage: null,
      lastAvatarText: null,
      lastStage: null,
    }),
}));
