import { useEffect, useRef } from 'react';
import { useWebSocketStore } from '../stores/websocketStore';
import { useSessionStore } from '../stores/sessionStore';

export type MockScenario = 'pre-calibration' | 'post-calibration' | 'target-reach' | 'trajectory-trace';

const FRAME_INTERVAL = 1000 / 30; // 30fps

/**
 * Generates synthetic WebSocket messages for all 4 exercise scenarios.
 * Only active when VITE_MOCK_MODE=true.
 */
export function useMockData(scenario: MockScenario = 'pre-calibration') {
  const isMockMode = useWebSocketStore((s) => s.isMockMode);
  const routeMessage = useWebSocketStore((s) => s.routeMessage);
  const frameRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Seed a realistic streak value for exercise scenarios so HUD multiplier is visible
  useEffect(() => {
    if (!isMockMode) return;
    if (scenario === 'target-reach' || scenario === 'trajectory-trace') {
      const currentStreak = useSessionStore.getState().streak;
      if (currentStreak < 5) {
        useSessionStore.setState({ streak: 5 });
      }
    }
  }, [isMockMode, scenario]);

  useEffect(() => {
    if (!isMockMode) return;

    frameRef.current = 0;

    intervalRef.current = setInterval(() => {
      const frame = frameRef.current++;
      const t = frame * FRAME_INTERVAL / 1000; // time in seconds

      switch (scenario) {
        case 'pre-calibration':
          generatePreCalibration(routeMessage, t);
          break;
        case 'post-calibration':
          generatePostCalibration(routeMessage, t);
          break;
        case 'target-reach':
          generateTargetReach(routeMessage, t);
          break;
        case 'trajectory-trace':
          generateTrajectoryTrace(routeMessage, t);
          break;
      }
    }, FRAME_INTERVAL);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isMockMode, scenario, routeMessage]);
}

type Router = (msg: { type: string; payload: Record<string, unknown> }) => void;

// ── Pre-calibration: arm barely detected, low angles ────────────────────────
function generatePreCalibration(route: Router, t: number) {
  // recognized flickers — mostly false, occasionally true
  const recognized = Math.random() < 0.15;
  route({ type: 'calibration:recognized', payload: { recognized } });

  // normalized_angle maxes at 0.25 — limited ROM before calibration
  const angle = 0.25 * Math.abs(Math.sin(t * 0.5)) * (0.8 + 0.2 * Math.random());
  route({ type: 'calibration:angle', payload: { angle } });

  // Send exercise angle too so stores stay in sync
  route({ type: 'exercise:normalized_angle', payload: { normalized_angle: angle } });
}

// ── Post-calibration: arm tracked, full ROM reaches 0.85 ────────────────────
function generatePostCalibration(route: Router, t: number) {
  route({ type: 'calibration:recognized', payload: { recognized: true } });

  // Smooth ramp up then oscillate near 0.85
  const rampedMax = Math.min(0.85, t * 0.1);
  const angle = rampedMax * (0.7 + 0.3 * Math.sin(t * 1.2));
  route({ type: 'calibration:angle', payload: { angle } });
  route({ type: 'exercise:normalized_angle', payload: { normalized_angle: angle } });

  // After a few seconds, set the ROM profile
  if (t > 3 && t < 3.05) {
    route({
      type: 'calibration:profile',
      payload: { maxFlexion: 145, maxExtension: 10, maxAbduction: 160 },
    });
  }
}

// ── Target reach: hand oscillates toward targets, hits every ~2.5s ──────────
function generateTargetReach(route: Router, t: number) {
  route({ type: 'calibration:recognized', payload: { recognized: true } });

  // Generate 3 fixed targets (on first frame only they're sent)
  if (t < 0.05) {
    route({
      type: 'exercise:target',
      payload: {
        targets: [
          { x: 0.3, y: 0.7, z: 0 },
          { x: -0.4, y: 0.5, z: 0 },
          { x: 0.1, y: 0.9, z: 0 },
        ],
      },
    });
  }

  // Hand position oscillates — reaches a target every ~2.5s
  const cycle = t % 2.5;
  const reach = Math.sin((cycle / 2.5) * Math.PI); // 0 → 1 → 0 over 2.5s
  const angle = 0.85 * reach;
  route({ type: 'exercise:normalized_angle', payload: { normalized_angle: angle } });
  route({ type: 'calibration:angle', payload: { angle } });

  // Score increments every ~2.5s
  if (cycle < 0.05 && t > 0.1) {
    const hits = Math.floor(t / 2.5);
    route({ type: 'exercise:score', payload: { score: hits, accuracy: 0.82 + 0.05 * Math.random() } });
  }
}

// ── Trajectory trace: sinusoidal path, ~78% accuracy ────────────────────────
function generateTrajectoryTrace(route: Router, t: number) {
  route({ type: 'calibration:recognized', payload: { recognized: true } });

  // Sinusoidal target path
  const idealAngle = 0.5 + 0.35 * Math.sin(t * 0.8);

  // Patient follows with noise — ~78% accuracy
  const noise = (Math.random() - 0.5) * 0.15;
  const actualAngle = idealAngle + noise;
  const clampedAngle = Math.max(0, Math.min(1, actualAngle));

  route({ type: 'exercise:normalized_angle', payload: { normalized_angle: clampedAngle } });
  route({ type: 'calibration:angle', payload: { angle: clampedAngle } });

  // Update accuracy score periodically
  if (Math.floor(t * 30) % 15 === 0) {
    const deviation = Math.abs(noise);
    const accuracy = Math.max(0, 1 - deviation * 4.5); // ~78% on average
    const score = Math.floor(t * 10);
    route({ type: 'exercise:score', payload: { score, accuracy } });
  }
}
