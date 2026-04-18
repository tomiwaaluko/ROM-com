import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// MediaPipe Pose landmark connections (subset for stick figure)
const CONNECTIONS: [number, number][] = [
  // Torso
  [11, 12], // shoulders
  [11, 23], // left shoulder → left hip
  [12, 24], // right shoulder → right hip
  [23, 24], // hips
  // Left arm
  [11, 13], [13, 15],
  // Right arm
  [12, 14], [14, 16],
  // Left leg
  [23, 25], [25, 27],
  // Right leg
  [24, 26], [26, 28],
  // Face (nose to shoulders)
  [0, 11], [0, 12],
];

// Neutral standing pose — 33 MediaPipe landmarks (x, y, z in normalized coords)
const NEUTRAL_POSE: [number, number, number][] = (() => {
  const landmarks: [number, number, number][] = new Array(33).fill([0, 0, 0]) as [number, number, number][];
  // Head
  landmarks[0] = [0, 1.7, 0];      // nose
  landmarks[1] = [0.03, 1.75, -0.02];
  landmarks[2] = [0.05, 1.75, -0.02];
  landmarks[3] = [0.07, 1.74, -0.02];
  landmarks[4] = [-0.03, 1.75, -0.02];
  landmarks[5] = [-0.05, 1.75, -0.02];
  landmarks[6] = [-0.07, 1.74, -0.02];
  landmarks[7] = [0.08, 1.72, -0.04];  // left ear
  landmarks[8] = [-0.08, 1.72, -0.04]; // right ear
  landmarks[9] = [0.03, 1.65, 0];  // mouth left
  landmarks[10] = [-0.03, 1.65, 0]; // mouth right
  // Shoulders
  landmarks[11] = [0.2, 1.4, 0];    // left shoulder
  landmarks[12] = [-0.2, 1.4, 0];   // right shoulder
  // Arms
  landmarks[13] = [0.35, 1.1, 0];   // left elbow
  landmarks[14] = [-0.35, 1.1, 0];  // right elbow
  landmarks[15] = [0.35, 0.85, 0.05]; // left wrist
  landmarks[16] = [-0.35, 0.85, 0.05]; // right wrist
  // Hands
  landmarks[17] = [0.38, 0.8, 0.05];
  landmarks[18] = [-0.38, 0.8, 0.05];
  landmarks[19] = [0.36, 0.78, 0.06];
  landmarks[20] = [-0.36, 0.78, 0.06];
  // Hips
  landmarks[23] = [0.12, 0.9, 0];
  landmarks[24] = [-0.12, 0.9, 0];
  // Knees
  landmarks[25] = [0.12, 0.5, 0.02];
  landmarks[26] = [-0.12, 0.5, 0.02];
  // Ankles
  landmarks[27] = [0.12, 0.1, 0];
  landmarks[28] = [-0.12, 0.1, 0];
  // Feet
  landmarks[29] = [0.13, 0.05, 0.08];
  landmarks[30] = [-0.13, 0.05, 0.08];
  landmarks[31] = [0.13, 0.02, 0.12];
  landmarks[32] = [-0.13, 0.02, 0.12];
  // Fill remaining with head area
  landmarks[21] = [0.36, 0.82, 0.05];
  landmarks[22] = [-0.36, 0.82, 0.05];
  return landmarks;
})();

// Joint indices to render as glowing spheres
const JOINT_INDICES = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

interface SkeletonOverlayProps {
  mockMode?: boolean;
  handPosition?: THREE.Vector3; // wrist position for target hit detection
}

export function SkeletonOverlay({ mockMode = true }: SkeletonOverlayProps) {
  const groupRef = useRef<THREE.Group>(null);
  const timeRef = useRef(0);

  // Build line geometry for connections
  const linePositions = useMemo(() => {
    const positions: number[] = [];
    for (const [a, b] of CONNECTIONS) {
      const pa = NEUTRAL_POSE[a];
      const pb = NEUTRAL_POSE[b];
      if (pa && pb) {
        positions.push(pa[0], pa[1], pa[2]);
        positions.push(pb[0], pb[1], pb[2]);
      }
    }
    return new Float32Array(positions);
  }, []);

  const lineGeometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    return geo;
  }, [linePositions]);

  // Subtle idle animation in mock mode
  useFrame((_, delta) => {
    if (!mockMode || !groupRef.current) return;
    timeRef.current += delta;
    // Gentle breathing motion
    const breathe = Math.sin(timeRef.current * 1.5) * 0.008;
    groupRef.current.position.y = breathe;
  });

  return (
    <group ref={groupRef} position={[0, -0.9, 0]}>
      {/* Bone lines */}
      <lineSegments geometry={lineGeometry}>
        <lineBasicMaterial
          color="#00d4ff"
          transparent
          opacity={0.6}
          linewidth={1}
        />
      </lineSegments>

      {/* Joint spheres */}
      {JOINT_INDICES.map((idx) => {
        const pos = NEUTRAL_POSE[idx];
        if (!pos) return null;
        return (
          <mesh key={idx} position={[pos[0], pos[1], pos[2]]}>
            <sphereGeometry args={[0.02, 8, 8]} />
            <meshBasicMaterial
              color="#00d4ff"
              transparent
              opacity={0.8}
            />
          </mesh>
        );
      })}

      {/* Glow effect on key joints */}
      {[15, 16].map((idx) => {
        const pos = NEUTRAL_POSE[idx];
        if (!pos) return null;
        return (
          <mesh key={`glow-${idx}`} position={[pos[0], pos[1], pos[2]]}>
            <sphereGeometry args={[0.04, 8, 8]} />
            <meshBasicMaterial
              color="#00d4ff"
              transparent
              opacity={0.2}
            />
          </mesh>
        );
      })}
    </group>
  );
}

// Export wrist position for target hit detection
export function getWristPosition(normalizedAngle: number): THREE.Vector3 {
  // Map normalized angle (0-1) to a wrist position in 3D space
  // Simulates arm raising from rest to full extension
  const basePos = NEUTRAL_POSE[16]; // right wrist
  const shoulder = NEUTRAL_POSE[12]; // right shoulder
  if (!basePos || !shoulder) return new THREE.Vector3(0, 0, 0);

  const armLength = 0.55;
  const angle = normalizedAngle * Math.PI * 0.5; // 0 → 90°
  const x = shoulder[0] - armLength * Math.sin(angle) * 0.5;
  const y = shoulder[1] - armLength * Math.cos(angle) + armLength * Math.sin(angle);
  const z = shoulder[2];

  return new THREE.Vector3(x, y - 0.9, z); // offset to match group position
}
