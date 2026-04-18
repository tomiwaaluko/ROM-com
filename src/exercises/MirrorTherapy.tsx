import { useEffect, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useWebSocket } from '../hooks/useWebSocket';
import { useExerciseStore } from '../stores/exerciseStore';
import { useCalibrationStore } from '../stores/calibrationStore';
import { useWebSocketStore } from '../stores/websocketStore';
import { ExerciseHUD } from '../components/ui/ExerciseHUD';
import { SkeletonOverlay, getWristPosition } from '../components/skeleton/SkeletonOverlay';

function MirrorHand({
  position,
  color,
}: {
  position: THREE.Vector3;
  color: string;
}) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    meshRef.current?.position.copy(position);
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[0.045, 16, 16]} />
      <meshBasicMaterial color={color} transparent opacity={0.85} />
    </mesh>
  );
}

function GhostPose({ position }: { position: THREE.Vector3 }) {
  return (
    <group>
      <group scale={[-1, 1, 1]}>
        <SkeletonOverlay mockMode={false} />
      </group>
      <MirrorHand position={position} color="#00ff88" />
    </group>
  );
}

function landmarkPosition(
  landmarks: Array<[number, number, number]>,
  index: number,
  fallback: THREE.Vector3
) {
  const point = landmarks[index];
  if (!point) return fallback;

  return new THREE.Vector3((point[0] - 0.5) * 2.2, 1.1 - point[1] * 2.2, point[2] ?? 0);
}

function MirrorScene({ mockMode }: { mockMode: boolean }) {
  const normalizedAngle = useExerciseStore((s) => s.normalizedAngle);
  const leftNormalizedAngle = useExerciseStore((s) => s.leftNormalizedAngle);
  const landmarks = useExerciseStore((s) => s.landmarks);
  const updateScore = useExerciseStore((s) => s.updateScore);
  const score = useExerciseStore((s) => s.score);
  const send = useWebSocketStore((s) => s.send);
  const elapsedRef = useRef(0);
  const scoreCooldownRef = useRef(0);
  const [matchPct, setMatchPct] = useState(0);
  const [mirroredTarget, setMirroredTarget] = useState(() => new THREE.Vector3());
  const [affectedHand, setAffectedHand] = useState(() => new THREE.Vector3());

  useFrame((_, delta) => {
    elapsedRef.current += delta;
    scoreCooldownRef.current = Math.max(0, scoreCooldownRef.current - delta);

    const source = mockMode
      ? 0.5 + 0.35 * Math.sin(elapsedRef.current * 1.4)
      : leftNormalizedAngle || normalizedAngle;
    const affected = mockMode
      ? source + 0.08 * Math.sin(elapsedRef.current * 3.1)
      : normalizedAngle;
    const mirrored = mockMode
      ? getWristPosition(source).multiply(new THREE.Vector3(-1, 1, 1))
      : landmarkPosition(
          landmarks,
          15,
          getWristPosition(source).multiply(new THREE.Vector3(-1, 1, 1))
        ).multiply(new THREE.Vector3(-1, 1, 1));
    const affectedPosition = mockMode
      ? getWristPosition(affected).multiply(new THREE.Vector3(-1, 1, 1))
      : landmarkPosition(landmarks, 16, getWristPosition(affected));
    const accuracy = Math.max(0, 1 - affectedPosition.distanceTo(mirrored) / 0.45);
    setMirroredTarget(mirrored);
    setAffectedHand(affectedPosition);
    setMatchPct(accuracy);

    if (accuracy > 0.88 && scoreCooldownRef.current === 0) {
      updateScore(score + 1, accuracy);
      send({ type: 'haptic', payload: { mode: 'buzz', duration: 100 } });
      scoreCooldownRef.current = 1.2;
    }
  });

  return (
    <>
      <ambientLight intensity={0.35} />
      <pointLight position={[0, 3, 3]} intensity={0.6} />

      <group position={[-1.1, 0, 0]}>
        <group scale={[-1, 1, 1]}>
          <SkeletonOverlay mockMode={mockMode} />
        </group>
        <MirrorHand position={mirroredTarget} color="#00d4ff" />
      </group>

      <group position={[1.1, 0, 0]}>
        <GhostPose position={mirroredTarget} />
        <MirrorHand position={affectedHand} color={matchPct > 0.88 ? '#00ff88' : '#ff8844'} />
      </group>
    </>
  );
}

export function MirrorTherapy({ mockMode = false }: { mockMode?: boolean }) {
  const { status } = useWebSocket();
  const isMockMode = useWebSocketStore((s) => s.isMockMode);
  const effectiveMock = mockMode || isMockMode;
  const startExercise = useExerciseStore((s) => s.startExercise);
  const setRecognized = useCalibrationStore((s) => s.setRecognized);

  useEffect(() => {
    startExercise('mirror_therapy');
    if (effectiveMock) setRecognized(true);
  }, [startExercise, effectiveMock, setRecognized]);

  if (status !== 'connected') {
    return <div style={styles.connecting}>Connecting...</div>;
  }

  return (
    <div style={styles.root}>
      <div style={styles.split} />
      <Canvas camera={{ position: [0, 0.2, 3.4], fov: 45 }} gl={{ antialias: true }}>
        <MirrorScene mockMode={effectiveMock} />
      </Canvas>
      <div style={styles.leftLabel}>Unaffected mirror</div>
      <div style={styles.rightLabel}>Affected match</div>
      <ExerciseHUD exerciseName="Mirror Therapy" />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    position: 'fixed',
    inset: 0,
    background: '#0a0d14',
  },
  split: {
    position: 'absolute',
    inset: '0 50% 0 auto',
    width: 1,
    background: 'rgba(0,212,255,0.25)',
    zIndex: 2,
  },
  leftLabel: {
    position: 'absolute',
    left: 28,
    bottom: 82,
    color: 'rgba(255,255,255,0.4)',
    fontFamily: 'ui-monospace, Consolas, monospace',
    fontSize: 12,
  },
  rightLabel: {
    position: 'absolute',
    right: 28,
    bottom: 82,
    color: 'rgba(255,255,255,0.4)',
    fontFamily: 'ui-monospace, Consolas, monospace',
    fontSize: 12,
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
