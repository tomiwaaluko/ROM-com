/**
 * Checks if hand position is within tolerance of the path position.
 */
export function scorePoint(
  handPos: { x: number; y: number },
  pathPos: { x: number; y: number },
  tolerance: number = 40
): boolean {
  const dx = handPos.x - pathPos.x;
  const dy = handPos.y - pathPos.y;
  return Math.sqrt(dx * dx + dy * dy) <= tolerance;
}

/**
 * Calculates accuracy as a percentage (0–100).
 */
export function calculateAccuracy(hits: number, total: number): number {
  if (total === 0) return 100;
  return Math.round((hits / total) * 100);
}
