import { useNavigate } from 'react-router-dom';
import { useExerciseStore } from '../../stores/exerciseStore';
import { useCalibrationStore } from '../../stores/calibrationStore';
import { useSessionStore } from '../../stores/sessionStore';
import { RecognitionIndicator } from '../calibration/RecognitionIndicator';

interface ExerciseHUDProps {
  exerciseName: string;
}

export function ExerciseHUD({ exerciseName }: ExerciseHUDProps) {
  const navigate = useNavigate();
  const score = useExerciseStore((s) => s.score);
  const streak = useSessionStore((s) => s.streak);
  const isRecognized = useCalibrationStore((s) => s.isRecognized);
  const exerciseScore = useExerciseStore((s) => s.accuracy);

  // Streak multiplier: x2 after 3, x3 after 6
  const multiplier = streak >= 6 ? 3 : streak >= 3 ? 2 : 1;

  return (
    <div style={styles.container}>
      {/* Score — top left */}
      <div style={styles.topLeft}>
        <div style={styles.scoreLabel}>SCORE</div>
        <div style={styles.scoreValue}>{score}</div>
        {exerciseScore > 0 && (
          <div style={styles.accuracy}>
            {Math.round(exerciseScore * 100)}% acc
          </div>
        )}
      </div>

      {/* Exercise name — top center */}
      <div style={styles.topCenter}>
        <div style={styles.exerciseName}>{exerciseName}</div>
      </div>

      {/* Streak — top right */}
      <div style={styles.topRight}>
        <div style={styles.streakLabel}>STREAK</div>
        <div style={styles.streakValue}>{streak}</div>
        {multiplier > 1 && (
          <div style={styles.multiplier}>x{multiplier}</div>
        )}
      </div>

      {/* Dashboard button — bottom right */}
      <div style={styles.bottomRight}>
        <button
          style={styles.dashBtn}
          onClick={() => navigate('/dashboard')}
        >
          Dashboard
        </button>
      </div>

      {/* Recognition indicator — bottom center */}
      <div style={styles.bottomCenter}>
        <RecognitionIndicator recognized={isRecognized} />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    zIndex: 10,
    fontFamily: 'ui-monospace, Consolas, monospace',
  },
  topLeft: {
    position: 'absolute',
    top: 24,
    left: 28,
  },
  scoreLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: '0.15em',
    marginBottom: 2,
  },
  scoreValue: {
    fontSize: 48,
    fontWeight: 700,
    color: '#fff',
    lineHeight: 1,
  },
  accuracy: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.35)',
    marginTop: 4,
  },
  topCenter: {
    position: 'absolute',
    top: 24,
    left: '50%',
    transform: 'translateX(-50%)',
  },
  exerciseName: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
  },
  topRight: {
    position: 'absolute',
    top: 24,
    right: 28,
    textAlign: 'right',
  },
  streakLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: '0.15em',
    marginBottom: 2,
  },
  streakValue: {
    fontSize: 48,
    fontWeight: 700,
    color: '#fff',
    lineHeight: 1,
  },
  multiplier: {
    fontSize: 18,
    fontWeight: 700,
    color: '#ffcc00',
    marginTop: 4,
    textShadow: '0 0 8px rgba(255,204,0,0.5)',
  },
  bottomRight: {
    position: 'absolute',
    bottom: 28,
    right: 28,
    pointerEvents: 'auto',
  },
  dashBtn: {
    background: 'rgba(30,45,66,0.8)',
    border: '1px solid rgba(255,120,47,0.3)',
    color: '#fff',
    padding: '6px 14px',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: 'ui-monospace, Consolas, monospace',
  },
  bottomCenter: {
    position: 'absolute',
    bottom: 28,
    left: '50%',
    transform: 'translateX(-50%)',
    pointerEvents: 'auto',
  },
};
