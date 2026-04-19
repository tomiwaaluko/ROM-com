import { useRef, useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { LandingPage } from './pages/LandingPage';
import { SetupPage } from './pages/SetupPage';
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
import { LiveAvatarView } from './components/avatar/LiveAvatarView';

const BACKEND = 'http://localhost:8000';

function PipelineControl() {
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`${BACKEND}/pipeline/status`)
      .then((r) => r.json())
      .then((d) => setRunning(d.running))
      .catch(() => {});
  }, []);

  async function toggle() {
    setLoading(true);
    try {
      const endpoint = running ? '/pipeline/stop' : '/pipeline/start';
      const res = await fetch(`${BACKEND}${endpoint}`, { method: 'POST' });
      const data = await res.json();
      setRunning(data.status === 'started' || data.status === 'already_running');
    } catch {
      alert('Could not reach backend.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <button
        onClick={toggle}
        disabled={loading}
        style={{
          fontSize: 15,
          padding: '6px 18px',
          cursor: loading ? 'wait' : 'pointer',
          background: running ? 'var(--accent-2)' : 'var(--accent)',
          color: '#fff',
          border: 'none',
          borderRadius: 4,
          marginRight: 10,
        }}
      >
        {loading ? '...' : running ? '⏹ Stop Pipeline' : '▶ Start Pipeline'}
      </button>
      <span style={{ color: running ? 'var(--accent-gold)' : 'var(--text-muted)', fontSize: 13 }}>
        {running ? '● Pipeline running (MediaPipe + gesture classifier)' : '○ Pipeline stopped'}
      </span>
    </div>
  );
}

function CameraPreview() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  async function startCamera() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setActive(true);
    } catch {
      setError('Camera access denied or unavailable.');
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
  }

  useEffect(() => () => { streamRef.current?.getTracks().forEach((t) => t.stop()); }, []);

  return (
    <div style={{ marginBottom: 16 }}>
      <h2>Camera Calibration Preview</h2>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
        <button
          onClick={active ? stopCamera : startCamera}
          style={{
            fontSize: 15,
            padding: '6px 18px',
            cursor: 'pointer',
            background: active ? 'var(--accent-2)' : 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
          }}
        >
          {active ? 'Stop Camera' : 'Start Camera'}
        </button>
        {active && <span style={{ color: 'var(--accent-gold)' }}>● Live</span>}
      </div>
      {error && <p style={{ color: 'var(--accent-3)' }}>{error}</p>}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{ width: 480, borderRadius: 6, border: '2px solid #444', display: active ? 'block' : 'none' }}
      />
    </div>
  );
}

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
      <h1>KineticLab - WebSocket Foundation</h1>
      <p>Status: <strong>{status}</strong> {isMockMode && '(mock mode)'}</p>
      <hr />
      <PipelineControl />
      <CameraPreview />
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
        <Link to="/avatar" style={{ fontSize: 18 }}>→ Live Avatar (Kai)</Link>
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
        <Route path="/" element={<LandingPage />} />
        <Route path="/dev" element={<Dashboard />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/calibration" element={<CalibrationPage />} />
        <Route path="/exercise/target-reach" element={<TargetReachPage />} />
        <Route path="/exercise/trajectory-trace" element={<TrajectoryTracePage />} />
        <Route path="/exercise/mirror-therapy" element={<MirrorTherapyPage />} />
        <Route path="/exercise/forearm-rotation" element={<ForearmRotationPage />} />
        <Route path="/exercise/bimanual-reach" element={<BimanualReachPage />} />
        <Route path="/avatar" element={<LiveAvatarView />} />
        <Route path="/dashboard" element={<DashboardPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
