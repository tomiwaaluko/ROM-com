import { Canvas } from '@react-three/fiber';
import { SkeletonOverlay } from '../skeleton/SkeletonOverlay';

export function LiveSkeletonMini() {
  return (
    <div style={styles.container}>
      <div style={styles.label}>LIVE</div>
      <Canvas
        camera={{ position: [0, 0.5, 2.2], fov: 40 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent' }}
      >
        <ambientLight intensity={0.3} />
        <SkeletonOverlay mockMode={true} />
      </Canvas>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: 200,
    height: 200,
    borderRadius: 12,
    overflow: 'hidden',
    background: '#1d120f',
    border: '1px solid #3d251d',
    position: 'relative',
  },
  label: {
    position: 'absolute',
    top: 8,
    right: 8,
    fontSize: 10,
    fontWeight: 700,
    color: '#F6A43C',
    fontFamily: 'ui-monospace, Consolas, monospace',
    letterSpacing: '0.12em',
    zIndex: 1,
    animation: 'pulse 2s ease-in-out infinite',
  },
};
