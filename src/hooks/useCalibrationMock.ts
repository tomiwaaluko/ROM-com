import { useEffect, useRef } from 'react';
import { useWebSocketStore } from '../stores/websocketStore';
import { useCalibrationStore, CAPTURE_PHASES } from '../stores/calibrationStore';

const FRAME_INTERVAL = 1000 / 30; // 30fps

/**
 * Mock data generator specific to the calibration wizard.
 * In mock mode, simulates angle rising 0° → 45° over 5 seconds during capture phases.
 * Pre-warms user_2 profile for instant switch.
 */
export function useCalibrationMock() {
  const isMockMode = useWebSocketStore((s) => s.isMockMode);
  const phase = useCalibrationStore((s) => s.phase);
  const updateLiveAngle = useCalibrationStore((s) => s.updateLiveAngle);
  const setRecognized = useCalibrationStore((s) => s.setRecognized);
  const userProfiles = useCalibrationStore((s) => s.userProfiles);
  const frameRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const preWarmedRef = useRef(false);

  // Pre-warm user_2 profile on first mount
  useEffect(() => {
    if (!isMockMode || preWarmedRef.current) return;
    preWarmedRef.current = true;

    if (!userProfiles['user_2']) {
      // Seed a pre-built profile for user_2
      const store = useCalibrationStore.getState();
      store.switchUser('user_2');
      // Manually set a complete profile
      useCalibrationStore.setState({
        currentUserId: 'user_2',
        romProfile: { maxFlexion: 130, maxExtension: 8, maxAbduction: 140 },
        calibrationComplete: true,
        isRecognized: true,
        phase: 'complete',
        capturedAngles: {
          shoulder_flex: 0.72,
          shoulder_abd: 0.78,
          elbow: 0.45,
          wrist: 0.33,
        },
        userProfiles: {
          ...store.userProfiles,
          user_2: {
            userId: 'user_2',
            profile: { maxFlexion: 130, maxExtension: 8, maxAbduction: 140 },
            capturedAngles: {
              shoulder_flex: 0.72,
              shoulder_abd: 0.78,
              elbow: 0.45,
              wrist: 0.33,
            },
            accentColor: '#F26B64',
          },
        },
      });
      // Switch back to user_1
      store.switchUser('user_1');
      useCalibrationStore.setState({
        currentUserId: 'user_1',
        phase: 'idle',
        romProfile: null,
        calibrationComplete: false,
        isRecognized: false,
        liveAngle: 0,
        capturedAngles: {},
      });
    }
  }, [isMockMode, userProfiles]);

  // Simulate angles during capture phases
  useEffect(() => {
    if (!isMockMode) return;

    const isCapture = CAPTURE_PHASES.includes(phase);

    // During intro, flicker recognition
    if (phase === 'intro') {
      const flickerInterval = setInterval(() => {
        setRecognized(Math.random() < 0.15);
      }, 200);
      return () => clearInterval(flickerInterval);
    }

    if (!isCapture) return;

    // Recognition is stable during capture
    setRecognized(true);
    frameRef.current = 0;

    intervalRef.current = setInterval(() => {
      const frame = frameRef.current++;
      const t = frame * FRAME_INTERVAL / 1000;

      // Rise from 0 → 0.25 (45°) over 5 seconds, then hold
      const rampDuration = 5;
      const maxAngle = 0.25;
      const angle = Math.min(maxAngle, (t / rampDuration) * maxAngle);

      // Add slight noise for realism
      const noise = (Math.random() - 0.5) * 0.005;
      const clampedAngle = Math.max(0, Math.min(1, angle + noise));

      updateLiveAngle(clampedAngle);
    }, FRAME_INTERVAL);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isMockMode, phase, updateLiveAngle, setRecognized]);
}
