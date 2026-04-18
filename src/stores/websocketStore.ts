import { create } from 'zustand';
import { useCalibrationStore } from './calibrationStore';
import { useSessionStore } from './sessionStore';
import { useExerciseStore } from './exerciseStore';

// ── Message types from backend ──────────────────────────────────────────────
export interface WSMessage {
  type: string;
  payload: Record<string, unknown>;
  timestamp?: number;
}

interface WebSocketState {
  // Connection state
  socket: WebSocket | null;
  status: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  reconnectDelay: number;
  isMockMode: boolean;

  // Actions
  connect: () => void;
  disconnect: () => void;
  send: (message: WSMessage) => void;
  enableMockMode: () => void;
  routeMessage: (message: WSMessage) => void;
}

const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY = 1000;

export const useWebSocketStore = create<WebSocketState>((set, get) => ({
  socket: null,
  status: 'disconnected',
  reconnectAttempts: 0,
  maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS,
  reconnectDelay: BASE_RECONNECT_DELAY,
  isMockMode: import.meta.env.VITE_MOCK_MODE === 'true',

  connect: () => {
    const state = get();

    // In mock mode, skip real WebSocket — data comes from useMockData
    if (state.isMockMode) {
      set({ status: 'connected' });
      return;
    }

    if (state.socket?.readyState === WebSocket.OPEN) return;

    set({ status: 'connecting' });

    const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8000/ws';
    const socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      set({ socket, status: 'connected', reconnectAttempts: 0, reconnectDelay: BASE_RECONNECT_DELAY });
    };

    socket.onmessage = (event) => {
      try {
        const message: WSMessage = JSON.parse(event.data);
        get().routeMessage(message);
      } catch {
        console.warn('[WS] Failed to parse message:', event.data);
      }
    };

    socket.onclose = () => {
      set({ socket: null, status: 'disconnected' });
      const { reconnectAttempts, maxReconnectAttempts, reconnectDelay } = get();
      if (reconnectAttempts < maxReconnectAttempts) {
        set({ status: 'reconnecting', reconnectAttempts: reconnectAttempts + 1 });
        setTimeout(() => get().connect(), reconnectDelay);
        set({ reconnectDelay: reconnectDelay * 2 }); // exponential backoff
      }
    };

    socket.onerror = () => {
      socket.close();
    };

    set({ socket });
  },

  disconnect: () => {
    const { socket } = get();
    if (socket) {
      socket.close();
    }
    set({ socket: null, status: 'disconnected', reconnectAttempts: MAX_RECONNECT_ATTEMPTS });
  },

  send: (message: WSMessage) => {
    const { socket, status, isMockMode } = get();
    if (isMockMode) {
      console.debug('[WS Mock] Would send:', message);
      return;
    }
    if (socket && status === 'connected') {
      socket.send(JSON.stringify(message));
    } else {
      console.warn('[WS] Cannot send — not connected');
    }
  },

  enableMockMode: () => {
    const { socket } = get();
    if (socket) socket.close();
    set({ isMockMode: true, status: 'connected', socket: null });
  },

  // ── Message router — dispatches incoming messages to the right store ────
  routeMessage: (message: WSMessage) => {
    const { type, payload } = message;

    switch (type) {
      // Calibration data from MediaPipe
      case 'calibration:angle':
        useCalibrationStore.getState().updateLiveAngle(payload.angle as number);
        break;
      case 'calibration:recognized':
        useCalibrationStore.getState().setRecognized(payload.recognized as boolean);
        break;
      case 'calibration:profile':
        useCalibrationStore.getState().setROMProfile({
          maxFlexion: payload.maxFlexion as number,
          maxExtension: payload.maxExtension as number,
          maxAbduction: payload.maxAbduction as number,
        });
        break;

      // Session data
      case 'session:fma_score':
        useSessionStore.getState().updateFMAScore(payload as Record<string, number>);
        break;
      case 'session:complete':
        useSessionStore.getState().completeSession(payload as Record<string, unknown>);
        break;

      // Exercise data
      case 'exercise:target':
        useExerciseStore.getState().updateTargets(payload.targets as Array<{ x: number; y: number; z: number }>);
        break;
      case 'exercise:score':
        useExerciseStore.getState().updateScore(payload.score as number, payload.accuracy as number);
        break;
      case 'exercise:normalized_angle':
        useExerciseStore.getState().updateNormalizedAngle(payload.normalized_angle as number);
        break;

      default:
        console.debug('[WS] Unhandled message type:', type);
    }
  },
}));
