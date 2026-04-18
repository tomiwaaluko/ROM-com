import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useWebSocket } from '../hooks/useWebSocket';
import { useExerciseStore } from '../stores/exerciseStore';
import { useCalibrationStore } from '../stores/calibrationStore';
import { useWebSocketStore } from '../stores/websocketStore';
import { ExerciseHUD } from '../components/ui/ExerciseHUD';

const TARGETS = [0, 90, 180, 270];
const HOLD_SECONDS = 1;
const TOLERANCE_DEG = 15;

function angleDistance(a: number, b: number) {
  const diff = Math.abs(a - b) % 360;
  const shortest = diff > 180 ? 360 - diff : diff;
  return Number.isNaN(shortest) ? 360 : shortest;
}

function RotationObject({ angleDeg, color }: { angleDeg: number; color: string }) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    if (groupRef.current) {
      groupRef.current.rotation.z = THREE.MathUtils.degToRad(angleDeg);
    }
  });

  return (
    <group ref={groupRef}>
      <mesh>
        <cylinderGeometry args={[0.08, 0.08, 1.2, 24]} />
        <meshStandardMaterial color={color} metalness={0.35} roughness={0.25} />
      </mesh>
      <mesh position={[0, 0.62, 0]}>
        <boxGeometry args={[0.32, 0.12, 0.12]} />
        <meshStandardMaterial color={color} metalness={0.35} roughness={0.25} />
      </mesh>
    </group>
  );
}

function RotationScene({
  mockMode,
  targetDeg,
  onHoldProgress,
  onTargetHeld,
}: {
  mockMode: boolean;
  targetDeg: number;
  onHoldProgress: (progress: number) => void;
  onTargetHeld: () => void;
}) {
  const forearmPronationRange = useExerciseStore((s) => s.forearmPronationRange);
  const normalizedAngle = useExerciseStore((s) => s.normalizedAngle);
  const elapsedRef = useRef(0);
  const holdRef = useRef(0);
  const [currentDeg, setCurrentDeg] = useState(0);

  useFrame((_, delta) => {
    elapsedRef.current += delta;
    const normalized = mockMode
      ? (Math.sin(elapsedRef.current * 1.2) + 1) / 2
      : forearmPronationRange || normalizedAngle;
    const angleDeg = normalized * 360;
    const inRange = angleDistance(angleDeg, targetDeg) <= TOLERANCE_DEG;
    setCurrentDeg(angleDeg);

    holdRef.current = inRange ? Math.min(HOLD_SECONDS, holdRef.current + delta) : 0;
    onHoldProgress(holdRef.current / HOLD_SECONDS);

    if (holdRef.current >= HOLD_SECONDS) {
      holdRef.current = 0;
      onTargetHeld();
    }
  });

  return (
    <>
      <ambientLight intensity={0.4} />
      <pointLight position={[2, 3, 3]} intensity={0.8} />
      <group rotation={[Math.PI / 2, 0, 0]}>
        <RotationObject angleDeg={targetDeg} color="#1e2d42" />
        <RotationObject angleDeg={currentDeg} color="#00d4ff" />
      </group>
    </>
  );
}

export function ForearmRotation({ mockMode = false }: { mockMode?: boolean }) {
  const { status } = useWebSocket();
  const isMockMode = useWebSocketStore((s) => s.isMockMode);
  const effectiveMock = mockMode || isMockMode;
  const startExercise = useExerciseStore((s) => s.startExercise);
  const updateScore = useExerciseStore((s) => s.updateScore);
  const score = useExerciseStore((s) => s.score);
  const send = useWebSocketStore((s) => s.send);
  const setRecognized = useCalibrationStore((s) => s.setRecognized);
  const [targetDeg, setTargetDeg] = useState(90);
  const [holdProgress, setHoldProgress] = useState(0);

  useEffect(() => {
    startExercise('forearm_rotation');
    if (effectiveMock) setRecognized(true);
  }, [startExercise, effectiveMock, setRecognized]);

  const nextTarget = useCallback(() => {
    setTargetDeg((current) => {
      const choices = TARGETS.filter((target) => target !== current);
      return choices[Math.floor(Math.random() * choices.length)];
    });
  }, []);

  const handleTargetHeld = useCallback(() => {
    updateScore(score + 1, 1);
    send({ type: 'haptic', payload: { mode: 'buzz', duration: 100 } });
    setHoldProgress(0);
    nextTarget();
  }, [score, updateScore, send, nextTarget]);

  const targetLabel = useMemo(() => `${targetDeg} deg`, [targetDeg]);

  if (status !== 'connected') {
    return <div style={styles.connecting}>Connecting...</div>;
  }

  return (
    <div style={styles.root}>
      <Canvas camera={{ position: [0, 0, 3], fov: 45 }} gl={{ antialias: true }}>
        <RotationScene
          mockMode={effectiveMock}
          targetDeg={targetDeg}
          onHoldProgress={setHoldProgress}
          onTargetHeld={handleTargetHeld}
        />
      </Canvas>
      <div style={styles.target}>Target {targetLabel}</div>
      <div style={styles.holdWrap}>
        <div style={{ ...styles.holdFill, width: `${holdProgress * 100}%` }} />
      </div>
      <ExerciseHUD exerciseName="Forearm Rotation" />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    position: 'fixed',
    inset: 0,
    background: '#0a0d14',
  },
  target: {
    position: 'absolute',
    left: '50%',
    bottom: 92,
    transform: 'translateX(-50%)',
    color: 'rgba(255,255,255,0.6)',
    fontFamily: 'ui-monospace, Consolas, monospace',
    fontSize: 13,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
  },
  holdWrap: {
    position: 'absolute',
    left: '50%',
    bottom: 64,
    width: 220,
    height: 8,
    transform: 'translateX(-50%)',
    borderRadius: 4,
    overflow: 'hidden',
    background: '#1e2d42',
  },
  holdFill: {
    height: '100%',
    background: '#00ff88',
    transition: 'width 80ms linear',
  },
  connecting: {
    background: '#0a0d14',
    color: '#fff',
    height: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'ui-monospace, Consolas, monospace',
  },
};
