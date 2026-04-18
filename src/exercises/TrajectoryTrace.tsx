import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useWebSocket } from '../hooks/useWebSocket';
import { useMockData } from '../hooks/useMockData';
import { useExerciseStore } from '../stores/exerciseStore';
import { useCalibrationStore } from '../stores/calibrationStore';
import { useWebSocketStore } from '../stores/websocketStore';
import { ExerciseHUD } from '../components/ui/ExerciseHUD';
import { SkeletonOverlay } from '../components/skeleton/SkeletonOverlay';
import { generatePath, getPositionAtTime } from '../utils/pathGenerator';
import type { PathPoint } from '../utils/pathGenerator';
import { scorePoint, calculateAccuracy } from '../utils/accuracyScoring';

// ── Constants ────────────────────────────────────────────────────────────────

const PATH_DURATION = 6; // seconds per path
const PATH_SEGMENTS = 4;
const TOLERANCE_PX = 40;
const SPAWN_DELAY = 1.5; // seconds between paths
const CANVAS_W = 800; // virtual canvas width for path generation
const CANVAS_H = 600; // virtual canvas height

// ── Convert pixel coords to NDC for 3D rendering ────────────────────────────

function pxToNDC(x: number, y: number): [number, number] {
  return [
    ((x / CANVAS_W) - 0.5) * 2.4,   // map to roughly -1.2 .. 1.2
    (0.5 - (y / CANVAS_H)) * 1.8,    // map to roughly -0.9 .. 0.9
  ];
}

// ── Path line component ─────────────────────────────────────────────────────

interface PathLineProps {
  path: PathPoint[];
  elapsed: number;
  handScreenPos: { x: number; y: number };
  onAccuracyUpdate: (hits: number, total: number) => void;
}

function PathLine({ path, elapsed, handScreenPos, onAccuracyUpdate }: PathLineProps) {
  const untracedRef = useRef<THREE.Line>(null);
  const tracedRef = useRef<THREE.Line>(null);
  const missedRef = useRef<THREE.Points>(null);
  const hitsRef = useRef(0);
  const totalRef = useRef(0);
  const lastScoredIndex = useRef(-1);

  // Build full path geometry (untraced portion — dim)
  const fullPositions = useMemo(() => {
    const arr: number[] = [];
    for (const p of path) {
      const [nx, ny] = pxToNDC(p.x, p.y);
      arr.push(nx, ny, 0);
    }
    return new Float32Array(arr);
  }, [path]);

  const fullGeometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(fullPositions, 3));
    return geo;
  }, [fullPositions]);

  // Per-frame update: build traced line + score points
  useFrame(() => {
    if (path.length === 0) return;

    // Find how far along the path we are
    const currentTime = Math.min(elapsed, path[path.length - 1].timestamp);
    let traceEndIdx = 0;
    for (let i = 0; i < path.length; i++) {
      if (path[i].timestamp <= currentTime) traceEndIdx = i;
      else break;
    }

    // Build traced geometry (only up to current position)
    if (tracedRef.current && traceEndIdx > 0) {
      const tracedArr: number[] = [];
      for (let i = 0; i <= traceEndIdx; i++) {
        const [nx, ny] = pxToNDC(path[i].x, path[i].y);
        tracedArr.push(nx, ny, 0);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tracedArr), 3));
      tracedRef.current.geometry.dispose();
      tracedRef.current.geometry = geo;
    }

    // Score new points
    if (traceEndIdx > lastScoredIndex.current) {
      for (let i = lastScoredIndex.current + 1; i <= traceEndIdx; i++) {
        totalRef.current++;
        const hit = scorePoint(handScreenPos, { x: path[i].x, y: path[i].y }, TOLERANCE_PX);
        if (hit) hitsRef.current++;
      }
      lastScoredIndex.current = traceEndIdx;
      onAccuracyUpdate(hitsRef.current, totalRef.current);
    }

    // Missed points — show red flashes for recent misses
    if (missedRef.current) {
      const missedArr: number[] = [];
      const lookback = Math.max(0, traceEndIdx - 5);
      for (let i = lookback; i <= traceEndIdx; i++) {
        const hit = scorePoint(handScreenPos, { x: path[i].x, y: path[i].y }, TOLERANCE_PX);
        if (!hit) {
          const [nx, ny] = pxToNDC(path[i].x, path[i].y);
          missedArr.push(nx, ny, 0);
        }
      }
      const geo = new THREE.BufferGeometry();
      if (missedArr.length > 0) {
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(missedArr), 3));
      }
      missedRef.current.geometry.dispose();
      missedRef.current.geometry = geo;
    }
  });

  return (
    <group position={[0, 0, -0.1]}>
      {/* Full path — dim untraced */}
      <line ref={untracedRef} geometry={fullGeometry}>
        <lineBasicMaterial color="#1e2d42" linewidth={2} />
      </line>

      {/* Traced portion — cyan glow */}
      <line ref={tracedRef}>
        <bufferGeometry />
        <lineBasicMaterial color="#00d4ff" linewidth={3} transparent opacity={0.9} />
      </line>

      {/* Missed points — red flash */}
      <points ref={missedRef}>
        <bufferGeometry />
        <pointsMaterial color="#ff4444" size={0.04} transparent opacity={0.7} />
      </points>
    </group>
  );
}

// ── Cursor dot (moves along path) ───────────────────────────────────────────

function PathCursor({ path, elapsed }: { path: PathPoint[]; elapsed: number }) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (!meshRef.current || path.length === 0) return;
    const pos = getPositionAtTime(path, elapsed);
    const [nx, ny] = pxToNDC(pos.x, pos.y);
    meshRef.current.position.set(nx, ny, 0);
  });

  return (
    <mesh ref={meshRef}>
      <circleGeometry args={[0.025, 16]} />
      <meshBasicMaterial color="#ffffff" transparent opacity={0.9} />
    </mesh>
  );
}

// ── Hand dot ────────────────────────────────────────────────────────────────

function HandDot({ screenPos, recognized }: { screenPos: { x: number; y: number }; recognized: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const timeRef = useRef(0);

  useFrame((_, delta) => {
    if (!meshRef.current) return;
    timeRef.current += delta;
    const [nx, ny] = pxToNDC(screenPos.x, screenPos.y);
    meshRef.current.position.set(nx, ny, 0.05);
    if (glowRef.current) glowRef.current.position.set(nx, ny, 0.04);

    const pulse = 1 + Math.sin(timeRef.current * 4) * 0.15;
    meshRef.current.scale.setScalar(pulse);
    if (glowRef.current) glowRef.current.scale.setScalar(pulse * 1.8);
  });

  const color = recognized ? '#00d4ff' : '#ff4444';

  return (
    <>
      <mesh ref={meshRef}>
        <circleGeometry args={[0.03, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} />
      </mesh>
      <mesh ref={glowRef}>
        <circleGeometry args={[0.05, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.2} />
      </mesh>
    </>
  );
}

// ── Accuracy bar (rendered in 3D space, right side) ─────────────────────────

function AccuracyBar({ accuracy }: { accuracy: number }) {
  const barHeight = 1.4;
  const fillHeight = (accuracy / 100) * barHeight;
  const barX = 1.45;
  const barBottomY = -0.7;

  return (
    <group position={[barX, barBottomY, 0.1]}>
      {/* Background bar */}
      <mesh position={[0, barHeight / 2, 0]}>
        <planeGeometry args={[0.06, barHeight]} />
        <meshBasicMaterial color="#1a1a2e" transparent opacity={0.8} />
      </mesh>
      {/* Fill bar */}
      {fillHeight > 0 && (
        <mesh position={[0, fillHeight / 2, 0.01]}>
          <planeGeometry args={[0.06, fillHeight]} />
          <meshBasicMaterial
            color={accuracy >= 80 ? '#00ff88' : accuracy >= 50 ? '#ffcc00' : '#ff4444'}
            transparent
            opacity={0.8}
          />
        </mesh>
      )}
    </group>
  );
}

// ── Scene content ───────────────────────────────────────────────────────────

function SceneContent({ mockMode }: { mockMode: boolean }) {
  const normalizedAngle = useExerciseStore((s) => s.normalizedAngle);
  const isRecognized = useCalibrationStore((s) => s.isRecognized);
  const send = useWebSocketStore((s) => s.send);
  const updateScore = useExerciseStore((s) => s.updateScore);

  const [currentPath, setCurrentPath] = useState<PathPoint[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [accuracy, setAccuracy] = useState(100);
  const [pathState, setPathState] = useState<'running' | 'waiting' | 'spawning'>('spawning');
  const waitTimerRef = useRef(0);

  // Hand screen position: map normalizedAngle to virtual canvas coords
  const handScreenPos = useMemo(() => {
    // Sinusoidal path following with noise in mock mode
    const x = CANVAS_W * 0.5 + normalizedAngle * CANVAS_W * 0.3 * Math.cos(elapsed * 1.2);
    const y = CANVAS_H * 0.5 - normalizedAngle * CANVAS_H * 0.35;
    return { x, y };
  }, [normalizedAngle, elapsed]);

  // Spawn a new path
  const spawnPath = useCallback(() => {
    const path = generatePath(PATH_SEGMENTS, CANVAS_W, CANVAS_H, PATH_DURATION);
    setCurrentPath(path);
    setElapsed(0);
    setAccuracy(100);
    setPathState('running');
  }, []);

  // Initial spawn
  useEffect(() => {
    if (pathState === 'spawning') {
      spawnPath();
    }
  }, [pathState, spawnPath]);

  // Handle accuracy updates from PathLine
  const handleAccuracyUpdate = useCallback(
    (hits: number, total: number) => {
      const acc = calculateAccuracy(hits, total);
      setAccuracy(acc);
      updateScore(Math.floor(hits * 0.5), acc / 100);
    },
    [updateScore]
  );

  // Frame update — track elapsed time and path completion
  useFrame((_, delta) => {
    if (pathState === 'running') {
      setElapsed((prev) => {
        const next = prev + delta;
        if (currentPath.length > 0 && next >= currentPath[currentPath.length - 1].timestamp) {
          // Path complete
          setPathState('waiting');
          waitTimerRef.current = 0;
          // Send haptic
          send({
            type: 'haptic',
            payload: { mode: 'vibrate', duration: 200 },
          });
        }
        return next;
      });
    } else if (pathState === 'waiting') {
      waitTimerRef.current += delta;
      if (waitTimerRef.current >= SPAWN_DELAY) {
        setPathState('spawning');
      }
    }
  });

  return (
    <>
      <ambientLight intensity={0.3} />

      {/* Skeleton always visible */}
      <SkeletonOverlay mockMode={mockMode} />

      {/* Path line */}
      {currentPath.length > 0 && pathState === 'running' && (
        <>
          <PathLine
            path={currentPath}
            elapsed={elapsed}
            handScreenPos={handScreenPos}
            onAccuracyUpdate={handleAccuracyUpdate}
          />
          <PathCursor path={currentPath} elapsed={elapsed} />
        </>
      )}

      {/* Hand dot */}
      <HandDot screenPos={handScreenPos} recognized={isRecognized} />

      {/* Accuracy bar */}
      <AccuracyBar accuracy={accuracy} />
    </>
  );
}

// ── Accuracy overlay (DOM — shows percentage number) ────────────────────────

function AccuracyOverlay({ accuracy }: { accuracy: number }) {
  return (
    <div style={overlayStyles.container}>
      <div
        style={{
          ...overlayStyles.value,
          color: accuracy >= 80 ? '#00ff88' : accuracy >= 50 ? '#ffcc00' : '#ff4444',
        }}
      >
        {accuracy}%
      </div>
      <div style={overlayStyles.label}>ACCURACY</div>
    </div>
  );
}

const overlayStyles: Record<string, React.CSSProperties> = {
  container: {
    position: 'absolute',
    right: 24,
    top: '50%',
    transform: 'translateY(-80%)',
    textAlign: 'center',
    zIndex: 10,
    pointerEvents: 'none',
  },
  value: {
    fontSize: 28,
    fontWeight: 700,
    fontFamily: 'ui-monospace, Consolas, monospace',
    lineHeight: 1,
  },
  label: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: '0.15em',
    marginTop: 4,
    fontFamily: 'ui-monospace, Consolas, monospace',
  },
};

// ── Main TrajectoryTrace component ──────────────────────────────────────────

interface TrajectoryTraceProps {
  mockMode?: boolean;
}

export function TrajectoryTrace({ mockMode = false }: TrajectoryTraceProps) {
  const { status } = useWebSocket();
  const isMockMode = useWebSocketStore((s) => s.isMockMode);
  const effectiveMock = mockMode || isMockMode;
  const startExercise = useExerciseStore((s) => s.startExercise);
  const setRecognized = useCalibrationStore((s) => s.setRecognized);
  const accuracy = useExerciseStore((s) => s.accuracy);

  useMockData('trajectory-trace');

  useEffect(() => {
    startExercise('trajectory_trace');
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
        camera={{ position: [0, 0, 2.5], fov: 50 }}
        gl={{ antialias: true, alpha: false }}
        onCreated={({ gl }) => {
          gl.setClearColor('#0a0d14');
        }}
      >
        <SceneContent mockMode={effectiveMock} />
      </Canvas>
      <ExerciseHUD exerciseName="Trajectory Trace" />
      <AccuracyOverlay accuracy={Math.round(accuracy * 100)} />
    </div>
  );
}
