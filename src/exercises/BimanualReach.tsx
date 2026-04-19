import { useEffect, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Sparkles } from '@react-three/drei';
import * as THREE from 'three';
import { useWebSocket } from '../hooks/useWebSocket';
import { useExerciseStore } from '../stores/exerciseStore';
import { useCalibrationStore } from '../stores/calibrationStore';
import { useWebSocketStore } from '../stores/websocketStore';
import { ExerciseHUD } from '../components/ui/ExerciseHUD';
import { SkeletonOverlay, getWristPosition } from '../components/skeleton/SkeletonOverlay';

const HIT_WINDOW_SECONDS = 0.5;
const HIT_RADIUS = 0.14;

function makeTargets(): { left: THREE.Vector3; right: THREE.Vector3 } {
  return {
    left: new THREE.Vector3(-0.9 - Math.random() * 0.35, 0.15 + Math.random() * 0.65, 0),
    right: new THREE.Vector3(0.9 + Math.random() * 0.35, 0.15 + Math.random() * 0.65, 0),
  };
}

function HandDot({ position, color }: { position: THREE.Vector3; color: string }) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    meshRef.current?.position.copy(position);
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[0.04, 14, 14]} />
      <meshBasicMaterial color={color} transparent opacity={0.9} />
    </mesh>
  );
}

function TargetDot({ position, hit }: { position: THREE.Vector3; hit: boolean }) {
  return (
    <group position={position}>
      <mesh>
        <sphereGeometry args={[0.075, 18, 18]} />
        <meshBasicMaterial color={hit ? '#F6A43C' : '#ff782f'} transparent opacity={0.9} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.14, 18, 18]} />
        <meshBasicMaterial color={hit ? '#F6A43C' : '#ff782f'} transparent opacity={0.14} />
      </mesh>
      {hit && <Sparkles count={20} scale={0.4} size={2.5} speed={1.5} color="#F6A43C" opacity={0.7} />}
    </group>
  );
}

function leftWristPosition(angle: number) {
  const pos = getWristPosition(angle);
  pos.x = Math.abs(pos.x);
  return pos;
}

function BimanualScene({
  mockMode,
  onWindowProgress,
}: {
  mockMode: boolean;
  onWindowProgress: (progress: number) => void;
}) {
  const normalizedAngle = useExerciseStore((s) => s.normalizedAngle);
  const leftNormalizedAngle = useExerciseStore((s) => s.leftNormalizedAngle);
  const updateScore = useExerciseStore((s) => s.updateScore);
  const send = useWebSocketStore((s) => s.send);
  const elapsedRef = useRef(0);
  const leftHitTime = useRef<number | null>(null);
  const rightHitTime = useRef<number | null>(null);
  const [targets, setTargets] = useState(makeTargets);
  const [leftHit, setLeftHit] = useState(false);
  const [rightHit, setRightHit] = useState(false);
  const [leftHandPosition, setLeftHandPosition] = useState(() => new THREE.Vector3());
  const [rightHandPosition, setRightHandPosition] = useState(() => new THREE.Vector3());

  useFrame((_, delta) => {
    elapsedRef.current += delta;
    const leftAngle = mockMode
      ? 0.5 + 0.42 * Math.sin(elapsedRef.current * 1.6)
      : leftNormalizedAngle;
    const rightAngle = mockMode
      ? 0.5 + 0.42 * Math.sin(elapsedRef.current * 1.6 + 0.35)
      : normalizedAngle;
    const leftHand = leftWristPosition(Math.max(0, Math.min(1, leftAngle)));
    const rightHand = getWristPosition(Math.max(0, Math.min(1, rightAngle)));
    setLeftHandPosition(leftHand);
    setRightHandPosition(rightHand);

    const now = elapsedRef.current;
    if (!leftHitTime.current && leftHand.distanceTo(targets.left) < HIT_RADIUS) {
      leftHitTime.current = now;
      setLeftHit(true);
    }
    if (!rightHitTime.current && rightHand.distanceTo(targets.right) < HIT_RADIUS) {
      rightHitTime.current = now;
      setRightHit(true);
    }

    if (leftHitTime.current || rightHitTime.current) {
      const first = Math.min(leftHitTime.current ?? now, rightHitTime.current ?? now);
      onWindowProgress(Math.max(0, 1 - (now - first) / HIT_WINDOW_SECONDS));
    } else {
      onWindowProgress(0);
    }

    if (leftHitTime.current && rightHitTime.current) {
      const diff = Math.abs(leftHitTime.current - rightHitTime.current);
      if (diff <= HIT_WINDOW_SECONDS) {
        const store = useExerciseStore.getState();
        updateScore(store.score + 1, 1 - diff / HIT_WINDOW_SECONDS);
        send({ type: 'haptic', payload: { mode: 'buzz', duration: 100 } });
      }
      leftHitTime.current = null;
      rightHitTime.current = null;
      setLeftHit(false);
      setRightHit(false);
      setTargets(makeTargets());
      onWindowProgress(0);
    }
  });

  return (
    <>
      <ambientLight intensity={0.35} />
      <pointLight position={[0, 3, 3]} intensity={0.7} />
      <SkeletonOverlay mockMode={mockMode} />
      <TargetDot position={targets.left} hit={leftHit} />
      <TargetDot position={targets.right} hit={rightHit} />
      <HandDot position={leftHandPosition} color="#F6A43C" />
      <HandDot position={rightHandPosition} color="#F26B64" />
    </>
  );
}

export function BimanualReach({ mockMode = false }: { mockMode?: boolean }) {
  const { status } = useWebSocket();
  const isMockMode = useWebSocketStore((s) => s.isMockMode);
  const effectiveMock = mockMode || isMockMode;
  const startExercise = useExerciseStore((s) => s.startExercise);
  const setRecognized = useCalibrationStore((s) => s.setRecognized);
  const [windowProgress, setWindowProgress] = useState(0);

  useEffect(() => {
    startExercise('bimanual');
    if (effectiveMock) setRecognized(true);
  }, [startExercise, effectiveMock, setRecognized]);

  if (status !== 'connected') {
    return <div style={styles.connecting}>Connecting...</div>;
  }

  return (
    <div style={styles.root}>
      <Canvas camera={{ position: [0, 0.2, 3], fov: 50 }} gl={{ antialias: true }}>
        <BimanualScene mockMode={effectiveMock} onWindowProgress={setWindowProgress} />
      </Canvas>
      <div style={styles.windowWrap}>
        <div style={{ ...styles.windowFill, width: `${windowProgress * 100}%` }} />
      </div>
      <div style={styles.windowLabel}>500ms timing window</div>
      <ExerciseHUD exerciseName="Bimanual Reach" />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    position: 'fixed',
    inset: 0,
    background: '#170f0d',
  },
  windowWrap: {
    position: 'absolute',
    left: '50%',
    bottom: 64,
    width: 260,
    height: 8,
    transform: 'translateX(-50%)',
    borderRadius: 4,
    overflow: 'hidden',
    background: '#3d251d',
  },
  windowFill: {
    height: '100%',
    background: '#F6A43C',
    transition: 'width 80ms linear',
  },
  windowLabel: {
    position: 'absolute',
    left: '50%',
    bottom: 82,
    transform: 'translateX(-50%)',
    color: 'rgba(255,255,255,0.45)',
    fontFamily: 'ui-monospace, Consolas, monospace',
    fontSize: 12,
  },
  connecting: {
    background: '#170f0d',
    color: '#fff',
    height: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'ui-monospace, Consolas, monospace',
  },
};
