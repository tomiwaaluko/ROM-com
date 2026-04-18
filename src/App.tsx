import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { useWebSocket } from './hooks/useWebSocket';
import { useMockData } from './hooks/useMockData';
import { useCalibrationStore } from './stores/calibrationStore';
import { useExerciseStore } from './stores/exerciseStore';
import { useSessionStore } from './stores/sessionStore';
import { CalibrationWizard } from './components/calibration/CalibrationWizard';
import { TargetReach } from './exercises/TargetReach';
import { TrajectoryTrace } from './exercises/TrajectoryTrace';
import { MirrorTherapy } from './exercises/MirrorTherapy';
import { ForearmRotation } from './exercises/ForearmRotation';
import { BimanualReach } from './exercises/BimanualReach';
import { TherapistDashboard } from './components/dashboard/TherapistDashboard';

function Dashboard() {
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
      <hr />
      <div style={{ display: 'flex', gap: 16, flexDirection: 'column' }}>
        <Link to="/calibration" style={{ fontSize: 18 }}>→ Launch Calibration Wizard</Link>
        <Link to="/exercise/target-reach" style={{ fontSize: 18 }}>→ Target Reach Exercise</Link>
        <Link to="/exercise/trajectory-trace" style={{ fontSize: 18 }}>→ Trajectory Trace Exercise</Link>
        <Link to="/exercise/mirror-therapy" style={{ fontSize: 18 }}>Mirror Therapy Exercise</Link>
        <Link to="/exercise/forearm-rotation" style={{ fontSize: 18 }}>Forearm Rotation Exercise</Link>
        <Link to="/exercise/bimanual-reach" style={{ fontSize: 18 }}>Bimanual Reach Exercise</Link>
        <Link to="/dashboard" style={{ fontSize: 18 }}>→ Therapist Dashboard</Link>
      </div>
    </div>
  );
}

function CalibrationPage() {
  const { status } = useWebSocket();
  if (status !== 'connected') {
    return <div style={{ color: '#fff', padding: 24 }}>Connecting...</div>;
  }
  return <CalibrationWizard />;
}

function TargetReachPage() {
  return <TargetReach />;
}

function TrajectoryTracePage() {
  return <TrajectoryTrace />;
}

function MirrorTherapyPage() {
  return <MirrorTherapy />;
}

function ForearmRotationPage() {
  return <ForearmRotation />;
}

function BimanualReachPage() {
  return <BimanualReach />;
}

function DashboardPage() {
  return <TherapistDashboard />;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/calibration" element={<CalibrationPage />} />
        <Route path="/exercise/target-reach" element={<TargetReachPage />} />
        <Route path="/exercise/trajectory-trace" element={<TrajectoryTracePage />} />
        <Route path="/exercise/mirror-therapy" element={<MirrorTherapyPage />} />
        <Route path="/exercise/forearm-rotation" element={<ForearmRotationPage />} />
        <Route path="/exercise/bimanual-reach" element={<BimanualReachPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
