import { useRef, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

const BACKEND = 'http://localhost:8000';

const SPRING_SOFT  = { type: 'spring', stiffness: 100, damping: 20 } as const;
const fadeUp = {
  hidden:  { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: SPRING_SOFT },
};
const stagger = {
  hidden:  {},
  visible: { transition: { staggerChildren: 0.1 } },
};

/* ─── Animated status dot ─────────────────────────────── */
function StatusDot({ active }: { active: boolean }) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      {active && (
        <motion.span
          style={{
            position: 'absolute',
            width: 10, height: 10,
            borderRadius: '50%',
            background: '#10B981',
            opacity: 0.4,
          }}
          animate={{ scale: [1, 2, 1], opacity: [0.4, 0, 0.4] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
      <span style={{
        width: 10, height: 10,
        borderRadius: '50%',
        background: active ? '#10B981' : '#374151',
        display: 'inline-block',
        position: 'relative',
      }} />
    </span>
  );
}

/* ─── Camera preview ──────────────────────────────────── */
function CameraPreview({ onStopRef }: { onStopRef: React.MutableRefObject<(() => void) | null> }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
  }, []);

  // Expose stop to parent so pipeline start can release camera first
  useEffect(() => { onStopRef.current = stop; }, [stop, onStopRef]);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setActive(true);
    } catch {
      setError('Camera access denied or unavailable.');
    }
  }, []);

  useEffect(() => () => { streamRef.current?.getTracks().forEach((t) => t.stop()); }, []);

  return (
    <motion.div variants={fadeUp} style={{ width: '100%' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 12,
      }}>
        <span style={{ color: '#9CA3AF', fontSize: 13, fontFamily: 'monospace', letterSpacing: '0.08em' }}>
          CAMERA PREVIEW
          <span style={{ color: '#4B5563', fontSize: 11, marginLeft: 8 }}>
            (auto-released when pipeline starts)
          </span>
        </span>
        <button
          onClick={active ? stop : start}
          style={{
            fontSize: 12,
            padding: '5px 14px',
            cursor: 'pointer',
            background: active ? 'rgba(239,68,68,0.15)' : 'rgba(0,212,255,0.1)',
            color: active ? '#EF4444' : '#00D4FF',
            border: `1px solid ${active ? 'rgba(239,68,68,0.3)' : 'rgba(0,212,255,0.25)'}`,
            borderRadius: 6,
            fontFamily: 'monospace',
            letterSpacing: '0.05em',
            transition: 'all 0.2s',
          }}
        >
          {active ? '⏹ Stop' : '▶ Preview'}
        </button>
      </div>

      <div style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '16/9',
        background: '#0d1117',
        borderRadius: 12,
        border: `1px solid ${active ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.06)'}`,
        overflow: 'hidden',
        transition: 'border-color 0.3s',
      }}>
        {!active && !error && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: 8,
          }}>
            <span style={{ fontSize: 32, opacity: 0.2 }}>◎</span>
            <span style={{ color: '#4B5563', fontSize: 13, fontFamily: 'monospace' }}>
              camera off
            </span>
          </div>
        )}
        {error && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ color: '#EF4444', fontSize: 13, fontFamily: 'monospace' }}>{error}</span>
          </div>
        )}
        <video
          ref={videoRef}
          autoPlay playsInline muted
          style={{
            width: '100%', height: '100%',
            objectFit: 'cover',
            display: active ? 'block' : 'none',
            transform: 'scaleX(-1)',
          }}
        />
        {active && (
          <div style={{
            position: 'absolute', top: 10, left: 10,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <StatusDot active={true} />
            <span style={{ color: '#10B981', fontSize: 11, fontFamily: 'monospace' }}>LIVE</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

/* ─── Step card ───────────────────────────────────────── */
function StepCard({
  index, label, description, done,
}: {
  index: number; label: string; description: string; done: boolean;
}) {
  return (
    <motion.div
      variants={fadeUp}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 14,
        padding: '14px 16px',
        borderRadius: 10,
        background: done ? 'rgba(16,185,129,0.06)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${done ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.06)'}`,
        transition: 'all 0.3s',
      }}
    >
      <div style={{
        width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: done ? '#10B981' : 'rgba(255,255,255,0.06)',
        color: done ? '#000' : '#6B7280',
        fontSize: 12, fontWeight: 700, fontFamily: 'monospace',
        transition: 'all 0.3s',
      }}>
        {done ? '✓' : index}
      </div>
      <div>
        <div style={{ color: done ? '#10B981' : '#D1D5DB', fontSize: 14, fontWeight: 600, marginBottom: 2 }}>
          {label}
        </div>
        <div style={{ color: '#6B7280', fontSize: 12, fontFamily: 'monospace' }}>{description}</div>
      </div>
    </motion.div>
  );
}

/* ─── Main page ───────────────────────────────────────── */
export function SetupPage() {
  const navigate = useNavigate();
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [backendReachable, setBackendReachable] = useState(false);
  const [checking, setChecking] = useState(true);
  const stopCameraRef = useRef<(() => void) | null>(null);

  // Poll pipeline + backend status
  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch(`${BACKEND}/pipeline/status`);
        const data = await res.json();
        if (!cancelled) {
          setPipelineRunning(data.running === true);
          setBackendReachable(true);
        }
      } catch {
        if (!cancelled) setBackendReachable(false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    }
    check();
    const id = setInterval(check, 2500);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  async function togglePipeline() {
    setLoading(true);
    try {
      const endpoint = pipelineRunning ? '/pipeline/stop' : '/pipeline/start';
      // Release browser camera before starting pipeline — both can't hold it at once
      if (!pipelineRunning) stopCameraRef.current?.();
      const res = await fetch(`${BACKEND}${endpoint}`, { method: 'POST' });
      const data = await res.json();
      setPipelineRunning(data.status === 'started' || data.status === 'already_running');
    } catch {
      // status will be updated on next poll
    } finally {
      setLoading(false);
    }
  }

  const steps = [
    {
      label: 'Backend connected',
      description: 'FastAPI server reachable on :8000',
      done: backendReachable,
    },
    {
      label: 'Pipeline running',
      description: 'MediaPipe + gesture classifier active',
      done: pipelineRunning,
    },
  ];

  const allReady = backendReachable && pipelineRunning;

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0a0a0f',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 20px',
      fontFamily: 'monospace',
    }}>
      {/* Subtle grid bg */}
      <svg
        style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', opacity: 0.03, pointerEvents: 'none' }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#fff" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>

      <motion.div
        initial="hidden"
        animate="visible"
        variants={stagger}
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 680,
          display: 'flex',
          flexDirection: 'column',
          gap: 28,
        }}
      >
        {/* Header */}
        <motion.div variants={fadeUp}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '4px 12px',
            borderRadius: 20,
            background: 'rgba(0,212,255,0.08)',
            border: '1px solid rgba(0,212,255,0.2)',
            marginBottom: 16,
          }}>
            <span style={{ color: '#00D4FF', fontSize: 11, letterSpacing: '0.1em' }}>SETUP</span>
          </div>

          <h1 style={{
            color: '#F9FAFB',
            fontSize: 'clamp(28px, 5vw, 40px)',
            fontWeight: 700,
            letterSpacing: '-0.02em',
            margin: 0,
            lineHeight: 1.15,
          }}>
            Start the pipeline
          </h1>
          <p style={{
            color: '#6B7280',
            fontSize: 14,
            marginTop: 10,
            lineHeight: 1.6,
          }}>
            The ML pipeline processes your camera feed for real-time pose detection.
            Start it below, verify your camera preview, then proceed to calibration.
          </p>
        </motion.div>

        {/* Step checklist */}
        <motion.div variants={stagger} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {steps.map((s, i) => (
            <StepCard key={s.label} index={i + 1} {...s} />
          ))}
        </motion.div>

        {/* Pipeline control */}
        <motion.div
          variants={fadeUp}
          style={{
            padding: '20px 24px',
            borderRadius: 14,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <StatusDot active={pipelineRunning} />
            <div>
              <div style={{ color: pipelineRunning ? '#10B981' : '#9CA3AF', fontSize: 14, fontWeight: 600 }}>
                {checking ? 'Checking…' : pipelineRunning ? 'Pipeline running' : 'Pipeline stopped'}
              </div>
              <div style={{ color: '#4B5563', fontSize: 11, marginTop: 2 }}>
                {pipelineRunning
                  ? 'MediaPipe · gesture classifier · ROM normalizer'
                  : 'Click start to activate camera processing'}
              </div>
            </div>
          </div>

          <motion.button
            onClick={togglePipeline}
            disabled={loading || !backendReachable}
            whileHover={!loading && backendReachable ? { scale: 1.04 } : {}}
            whileTap={!loading && backendReachable ? { scale: 0.97 } : {}}
            style={{
              fontSize: 13,
              padding: '10px 22px',
              cursor: loading || !backendReachable ? 'not-allowed' : 'pointer',
              background: pipelineRunning
                ? 'rgba(239,68,68,0.12)'
                : 'rgba(0,212,255,0.12)',
              color: pipelineRunning ? '#EF4444' : '#00D4FF',
              border: `1px solid ${pipelineRunning ? 'rgba(239,68,68,0.3)' : 'rgba(0,212,255,0.3)'}`,
              borderRadius: 8,
              fontFamily: 'monospace',
              letterSpacing: '0.05em',
              opacity: !backendReachable ? 0.4 : 1,
              transition: 'all 0.2s',
              flexShrink: 0,
            }}
          >
            {loading ? '…' : pipelineRunning ? '⏹ Stop Pipeline' : '▶ Start Pipeline'}
          </motion.button>
        </motion.div>

        {/* Camera preview */}
        <CameraPreview onStopRef={stopCameraRef} />

        {/* CTA */}
        <motion.div variants={fadeUp} style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <motion.button
            onClick={() => navigate('/calibration')}
            disabled={!allReady}
            whileHover={allReady ? { scale: 1.03 } : {}}
            whileTap={allReady ? { scale: 0.97 } : {}}
            style={{
              flex: 1,
              minWidth: 200,
              padding: '14px 28px',
              fontSize: 15,
              fontWeight: 700,
              fontFamily: 'monospace',
              letterSpacing: '0.05em',
              cursor: allReady ? 'pointer' : 'not-allowed',
              background: allReady
                ? 'linear-gradient(135deg, #00D4FF 0%, #10B981 100%)'
                : 'rgba(255,255,255,0.05)',
              color: allReady ? '#000' : '#4B5563',
              border: 'none',
              borderRadius: 10,
              transition: 'all 0.3s',
            }}
          >
            {allReady ? 'Continue to Calibration →' : 'Start pipeline to continue'}
          </motion.button>

          <AnimatePresence>
            {!allReady && (
              <motion.span
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                style={{ color: '#4B5563', fontSize: 12, fontFamily: 'monospace' }}
              >
                {!backendReachable ? '⚠ Backend unreachable' : '⚠ Pipeline not running'}
              </motion.span>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Back link */}
        <motion.div variants={fadeUp} style={{ textAlign: 'center' }}>
          <button
            onClick={() => navigate('/')}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#4B5563', fontSize: 12, fontFamily: 'monospace',
              textDecoration: 'underline',
            }}
          >
            ← Back to home
          </button>
        </motion.div>
      </motion.div>
    </div>
  );
}
