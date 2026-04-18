import { useEffect } from 'react';
import { useWebSocketStore } from '../stores/websocketStore';
import { useCalibrationStore } from '../stores/calibrationStore';
import { useSessionStore } from '../stores/sessionStore';
import { useExerciseStore } from '../stores/exerciseStore';

/**
 * Hook that connects a component to the WebSocket store.
 * Call once at the app root — it manages connect/disconnect lifecycle.
 */
export function useWebSocket() {
  const connect = useWebSocketStore((s) => s.connect);
  const disconnect = useWebSocketStore((s) => s.disconnect);
  const status = useWebSocketStore((s) => s.status);
  const isMockMode = useWebSocketStore((s) => s.isMockMode);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return { status, isMockMode };
}

/**
 * Convenience re-exports for components that need store data.
 */
export { useCalibrationStore, useSessionStore, useExerciseStore };
