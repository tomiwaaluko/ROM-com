import { motion } from 'framer-motion';

interface ROMProgressArcProps {
  angle: number; // 0–1 normalized
  maxPossible?: number; // max normalized value (default 1)
  color?: string;
  size?: number;
}

export function ROMProgressArc({
  angle,
  maxPossible = 1,
  color = '#F26B64',
  size = 200,
}: ROMProgressArcProps) {
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;

  // Arc spans 180° (bottom half = semicircle from left to right)
  const startAngle = Math.PI; // left
  const sweepFraction = Math.min(angle / maxPossible, 1);
  const endAngle = startAngle + Math.PI * sweepFraction;

  const arcPath = describeArc(cx, cy, radius, startAngle, endAngle);
  const bgPath = describeArc(cx, cy, radius, startAngle, startAngle + Math.PI);

  // Color transitions from orange to magenta as it fills
  const fillColor =
    sweepFraction > 0.8
      ? lerpColor(color, '#F6A43C', (sweepFraction - 0.8) / 0.2)
      : color;

  const degrees = Math.round(angle * 180);

  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background track */}
        <path
          d={bgPath}
          fill="none"
          stroke="rgba(255,255,255,0.1)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        {/* Animated fill arc */}
        {sweepFraction > 0.001 && (
          <motion.path
            d={arcPath}
            fill="none"
            stroke={fillColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            initial={false}
            animate={{ d: arcPath }}
            transition={{ duration: 0.033 }}
            style={{
              filter: `drop-shadow(0 0 6px ${fillColor})`,
            }}
          />
        )}
      </svg>
      {/* Center angle readout */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -30%)',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            fontFamily: 'ui-monospace, Consolas, monospace',
            fontSize: size * 0.22,
            fontWeight: 700,
            color: '#fff',
            lineHeight: 1,
          }}
        >
          {degrees}°
        </div>
      </div>
    </div>
  );
}

function describeArc(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number
): string {
  const x1 = cx + r * Math.cos(startAngle);
  const y1 = cy + r * Math.sin(startAngle);
  const x2 = cx + r * Math.cos(endAngle);
  const y2 = cy + r * Math.sin(endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
}

function lerpColor(a: string, b: string, t: number): string {
  const parse = (hex: string) => {
    const h = hex.replace('#', '');
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  };
  const ca = parse(a);
  const cb = parse(b);
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
}
