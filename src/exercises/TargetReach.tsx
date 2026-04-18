import { useRef, useState, useCallback, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Sparkles } from '@react-three/drei';
import * as THREE from 'three';
import { useWebSocket } from '../hooks/useWebSocket';
import { useMockData } from '../hooks/useMockData';
import { useExerciseStore } from '../stores/exerciseStore';
import { useCalibrationStore } from '../stores/calibrationStore';
import { useWebSocketStore } from '../stores/websocketStore';
import { ExerciseHUD } from '../components/ui/ExerciseHUD';
import { SkeletonOverlay, getWristPosition } from '../components/skeleton/SkeletonOverlay';

// ── Target sphere component ─────────────────────────────────────────────────

interface TargetSphereProps {
  position: [number, number, number];
  id: number;
  handPosition: THREE.Vector3;
  onHit: (id: number) => void;
  hitRadius?: number;
  approachRadius?: number;
}

function TargetSphere({
  position,
  id,
  handPosition,
  onHit,
  hitRadius = 0.12,
  approachRadius = 0.25,
}: TargetSphereProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const [state, setState] = useState<'idle' | 'approach' | 'hit'>('idle');
  const hitFired = useRef(false);
  const shrinkProgress = useRef(0);
  const timeRef = useRef(Math.random() * 10); // offset so targets pulse out of phase

  useFrame((_, delta) => {
    if (!meshRef.current) return;
    timeRef.current += delta;

    const targetPos = new THREE.Vector3(...position);
    const dist = handPosition.distanceTo(targetPos);

    if (state === 'hit') {
      // Shrink to nothing
      shrinkProgress.current += delta * 3;
      const scale = Math.max(0, 1 - shrinkProgress.current);
      meshRef.current.scale.setScalar(scale);
      if (glowRef.current) glowRef.current.scale.setScalar(scale * 1.5);
      if (scale <= 0) {
        meshRef.current.visible = false;
        if (glowRef.current) glowRef.current.visible = false;
      }
      return;
    }

    // Check approach / hit
    if (dist < hitRadius && !hitFired.current) {
      hitFired.current = true;
      setState('hit');
      onHit(id);
      return;
    }

    if (dist < approachRadius && state !== 'approach') {
      setState('approach');
    } else if (dist >= approachRadius && state === 'approach') {
      setState('idle');
    }

    // Pulsing animation
    const pulse = state === 'approach'
      ? 1 + Math.sin(timeRef.current * 8) * 0.15  // fast pulse when approaching
      : 1 + Math.sin(timeRef.current * 2) * 0.08; // gentle idle pulse
    meshRef.current.scale.setScalar(pulse);
    if (glowRef.current) glowRef.current.scale.setScalar(pulse * 1.8);
  });

  const color = state === 'approach' ? '#ffffff' : '#00d4ff';
  const glowColor = state === 'approach' ? '#ffffff' : '#00d4ff';

  return (
    <group position={position}>
      {/* Core sphere */}
      <mesh ref={meshRef}>
        <sphereGeometry args={[0.06, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} />
      </mesh>
      {/* Glow sphere */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[0.1, 16, 16]} />
        <meshBasicMaterial color={glowColor} transparent opacity={0.15} />
      </mesh>
      {/* Particle burst on hit */}
      {state === 'hit' && (
        <Sparkles
          count={30}
          scale={0.5}
          size={3}
          speed={2}
          color="#00ff88"
          opacity={0.8}
        />
      )}
    </group>
  );
}

// ── Hand indicator (follows wrist position) ─────────────────────────────────

function HandIndicator({ position }: { position: THREE.Vector3 }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const timeRef = useRef(0);

  useFrame((_, delta) => {
    if (!meshRef.current) return;
    timeRef.current += delta;
    meshRef.current.position.copy(position);
    // Gentle pulse
    const s = 1 + Math.sin(timeRef.current * 3) * 0.1;
    meshRef.current.scale.setScalar(s);
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[0.035, 12, 12]} />
      <meshBasicMaterial color="#ff8844" transparent opacity={0.7} />
    </mesh>
  );
}

// ── Scene content (inside Canvas) ───────────────────────────────────────────

interface TargetData {
  id: number;
  position: [number, number, number];
  alive: boolean;
}

function SceneContent({ mockMode }: { mockMode: boolean }) {
  const normalizedAngle = useExerciseStore((s) => s.normalizedAngle);
  const targets = useExerciseStore((s) => s.targets);
  const romProfile = useCalibrationStore((s) => s.romProfile);
  const send = useWebSocketStore((s) => s.send);
  const updateScore = useExerciseStore((s) => s.updateScore);
  const score = useExerciseStore((s) => s.score);

  const [activeTargets, setActiveTargets] = useState<TargetData[]>([]);
  const nextIdRef = useRef(0);
  const spawnTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consecutiveHits = useRef(0);

  // Map store targets to 3D positions scaled by ROM envelope
  const romScale = romProfile
    ? Math.min(romProfile.maxFlexion, 180) / 180
    : 0.75; // default if no calibration

  // Initialize targets from store
  useEffect(() => {
    if (targets.length > 0 && activeTargets.length === 0) {
      const mapped = targets.map((t) => ({
        id: nextIdRef.current++,
        position: [
          t.x * 1.5,
          0.2 + t.y * romScale * 1.2,
          t.z,
        ] as [number, number, number],
        alive: true,
      }));
      setActiveTargets(mapped);
    }
  }, [targets, activeTargets.length, romScale]);

  // Calculate hand position from normalized angle
  const handPosition = getWristPosition(normalizedAngle);

  // Spawn a new target at a random position within ROM envelope
  const spawnTarget = useCallback(() => {
    const id = nextIdRef.current++;
    const x = (Math.random() - 0.5) * 1.2;
    const y = 0.2 + Math.random() * romScale * 1.0;
    const z = (Math.random() - 0.5) * 0.3;
    setActiveTargets((prev) => [
      ...prev.filter((t) => t.alive),
      { id, position: [x, y, z], alive: true },
    ]);
  }, [romScale]);

  // Handle target hit
  const handleHit = useCallback(
    (id: number) => {
      setActiveTargets((prev) =>
        prev.map((t) => (t.id === id ? { ...t, alive: false } : t))
      );

      consecutiveHits.current++;
      const streak = consecutiveHits.current;
      const multiplier = streak >= 6 ? 3 : streak >= 3 ? 2 : 1;
      const newScore = score + multiplier;
      const accuracy = 0.8 + Math.random() * 0.15;
      updateScore(newScore, accuracy);

      // Send haptic feedback
      send({
        type: 'haptic',
        payload: { mode: 'buzz', duration: 100 },
      });

      // Spawn replacement after 800ms
      if (spawnTimeoutRef.current) clearTimeout(spawnTimeoutRef.current);
      spawnTimeoutRef.current = setTimeout(spawnTarget, 800);
    },
    [score, updateScore, send, spawnTarget]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (spawnTimeoutRef.current) clearTimeout(spawnTimeoutRef.current);
    };
  }, []);

  return (
    <>
      {/* Ambient light for visibility */}
      <ambientLight intensity={0.3} />
      <pointLight position={[0, 3, 2]} intensity={0.5} />

      {/* Skeleton always visible */}
      <SkeletonOverlay mockMode={mockMode} />

      {/* Hand position indicator */}
      <HandIndicator position={handPosition} />

      {/* Target spheres */}
      {activeTargets
        .filter((t) => t.alive)
        .map((t) => (
          <TargetSphere
            key={t.id}
            id={t.id}
            position={t.position}
            handPosition={handPosition}
            onHit={handleHit}
          />
        ))}

      {/* Subtle background particles */}
      <Sparkles
        count={40}
        scale={4}
        size={1}
        speed={0.3}
        color="#00d4ff"
        opacity={0.15}
      />
    </>
  );
}

// ── Main TargetReach component ──────────────────────────────────────────────

interface TargetReachProps {
  mockMode?: boolean;
}

export function TargetReach({ mockMode = false }: TargetReachProps) {
  const { status } = useWebSocket();
  const isMockMode = useWebSocketStore((s) => s.isMockMode);
  const effectiveMock = mockMode || isMockMode;
  const startExercise = useExerciseStore((s) => s.startExercise);
  const setRecognized = useCalibrationStore((s) => s.setRecognized);

  // Activate mock data for target-reach scenario
  useMockData('target-reach');

  // Start exercise and set recognized on mount
  useEffect(() => {
    startExercise('target_reach');
    if (effectiveMock) {
      setRecognized(true);
    }
  }, [startExercise, effectiveMock, setRecognized]);

  if (status !== 'connected') {
    return (
      <div
        style={{
          background: '#0a0d14',
          color: '#fff',
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'ui-monospace, Consolas, monospace',
        }}
      >
        Connecting...
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0a0d14' }}>
      <Canvas
        camera={{ position: [0, 0.5, 2.5], fov: 50 }}
        gl={{ antialias: true, alpha: false }}
        onCreated={({ gl }) => {
          gl.setClearColor('#0a0d14');
        }}
      >
        <SceneContent mockMode={effectiveMock} />
      </Canvas>
      <ExerciseHUD exerciseName="Target Reach" />
    </div>
  );
}
