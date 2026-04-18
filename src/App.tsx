import { useWebSocket } from './hooks/useWebSocket';
import { useMockData } from './hooks/useMockData';
import { useCalibrationStore } from './stores/calibrationStore';
import { useExerciseStore } from './stores/exerciseStore';
import { useSessionStore } from './stores/sessionStore';

function App() {
  const { status, isMockMode } = useWebSocket();
  useMockData('pre-calibration');

  const liveAngle = useCalibrationStore((s) => s.liveAngle);
  const isRecognized = useCalibrationStore((s) => s.isRecognized);
  const normalizedAngle = useExerciseStore((s) => s.normalizedAngle);
  const score = useExerciseStore((s) => s.score);
  const streak = useSessionStore((s) => s.streak);

  return (
    <div style={{ fontFamily: 'monospace', padding: 24 }}>
      <h1>KineticLab — WebSocket Foundation</h1>
      <p>Status: <strong>{status}</strong> {isMockMode && '(mock mode)'}</p>
      <hr />
      <h2>Live Store Values</h2>
      <ul>
        <li>Recognized: {isRecognized ? 'YES' : 'NO'}</li>
        <li>Live Angle: {liveAngle.toFixed(3)}</li>
        <li>Normalized Angle: {normalizedAngle.toFixed(3)}</li>
        <li>Score: {score}</li>
        <li>Streak: {streak}</li>
      </ul>
    </div>
  );
}

export default App;
