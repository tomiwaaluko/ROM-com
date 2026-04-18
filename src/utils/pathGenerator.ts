export interface PathPoint {
  x: number;
  y: number;
  timestamp: number;
}

// Cubic bezier interpolation between 4 control points
function cubicBezier(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  t: number
): { x: number; y: number } {
  const u = 1 - t;
  const uu = u * u;
  const uuu = uu * u;
  const tt = t * t;
  const ttt = tt * t;
  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
  };
}

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * Generates a smooth bezier curve path across the canvas.
 * @param segments Number of bezier segments (3–6 recommended)
 * @param canvasWidth Canvas pixel width
 * @param canvasHeight Canvas pixel height
 * @param duration Total traversal time in seconds (4–8)
 * @returns Array of PathPoints sampled at ~60fps density
 */
export function generatePath(
  segments: number,
  canvasWidth: number,
  canvasHeight: number,
  duration: number = 6
): PathPoint[] {
  const margin = 0.2;
  const minX = canvasWidth * margin;
  const maxX = canvasWidth * (1 - margin);
  const minY = canvasHeight * margin;
  const maxY = canvasHeight * (1 - margin);

  // Generate anchor points for each segment boundary
  const anchors: { x: number; y: number }[] = [];
  for (let i = 0; i <= segments; i++) {
    anchors.push({
      x: randomInRange(minX, maxX),
      y: randomInRange(minY, maxY),
    });
  }

  // Build cubic bezier segments with smooth control points
  const samplesPerSegment = Math.ceil((60 * duration) / segments);
  const points: PathPoint[] = [];
  const totalSamples = samplesPerSegment * segments;

  for (let seg = 0; seg < segments; seg++) {
    const p0 = anchors[seg];
    const p3 = anchors[seg + 1];

    // Control points: pull toward perpendicular direction for organic curves
    const dx = p3.x - p0.x;
    const dy = p3.y - p0.y;
    const spread = 0.4;

    const p1 = {
      x: clamp(p0.x + dx * 0.33 + randomInRange(-1, 1) * Math.abs(dy) * spread, minX, maxX),
      y: clamp(p0.y + dy * 0.33 + randomInRange(-1, 1) * Math.abs(dx) * spread, minY, maxY),
    };
    const p2 = {
      x: clamp(p0.x + dx * 0.66 + randomInRange(-1, 1) * Math.abs(dy) * spread, minX, maxX),
      y: clamp(p0.y + dy * 0.66 + randomInRange(-1, 1) * Math.abs(dx) * spread, minY, maxY),
    };

    for (let i = 0; i < samplesPerSegment; i++) {
      // Skip first point of subsequent segments (shared with previous segment's last point)
      if (seg > 0 && i === 0) continue;
      const t = i / (samplesPerSegment - 1);
      const pt = cubicBezier(p0, p1, p2, p3, t);
      const globalIndex = seg * samplesPerSegment + i;
      points.push({
        x: pt.x,
        y: pt.y,
        timestamp: (globalIndex / totalSamples) * duration,
      });
    }
  }

  return points;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Interpolates a position along the path at time t (seconds).
 * Returns the interpolated {x, y} position.
 */
export function getPositionAtTime(
  path: PathPoint[],
  t: number
): { x: number; y: number } {
  if (path.length === 0) return { x: 0, y: 0 };
  if (t <= path[0].timestamp) return { x: path[0].x, y: path[0].y };
  if (t >= path[path.length - 1].timestamp) {
    const last = path[path.length - 1];
    return { x: last.x, y: last.y };
  }

  // Binary search for the bracketing points
  let lo = 0;
  let hi = path.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (path[mid].timestamp <= t) lo = mid;
    else hi = mid;
  }

  const a = path[lo];
  const b = path[hi];
  const frac = (t - a.timestamp) / (b.timestamp - a.timestamp);
  return {
    x: a.x + (b.x - a.x) * frac,
    y: a.y + (b.y - a.y) * frac,
  };
}
