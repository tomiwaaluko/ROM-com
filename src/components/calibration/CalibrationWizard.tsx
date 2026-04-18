import { useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useCalibrationStore, CAPTURE_PHASES } from '../../stores/calibrationStore';
import type { CalibrationPhase } from '../../stores/calibrationStore';
import { RecognitionIndicator } from './RecognitionIndicator';
import { ROMProgressArc } from './ROMProgressArc';
import { useCalibrationMock } from '../../hooks/useCalibrationMock';

const PHASE_LABELS: Record<CalibrationPhase, string> = {
  idle: '',
  intro: 'Get Ready',
  shoulder_flex: 'Shoulder Flexion',
  shoulder_abd: 'Shoulder Abduction',
  elbow: 'Elbow Flexion',
  wrist: 'Wrist Extension',
  complete: 'Calibration Complete',
};

const PHASE_INSTRUCTIONS: Record<string, string> = {
  intro: 'Stand facing the camera with your arms at your sides. We\'ll capture your range of motion across 4 joints.',
  shoulder_flex: 'Raise your arm forward and up as high as comfortable, then lower it back down.',
  shoulder_abd: 'Raise your arm out to the side as high as comfortable, then lower it back down.',
  elbow: 'Bend your elbow fully, then straighten it back out.',
  wrist: 'Extend your wrist back as far as comfortable, then relax.',
};

// Web Audio beeps — no external audio files
function playBeep(frequency: number, duration: number) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    gain.gain.value = 0.15;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.stop(ctx.currentTime + duration);
  } catch {
    // Audio context may not be available
  }
}

export function CalibrationWizard() {
  const phase = useCalibrationStore((s) => s.phase);
  const isRecognized = useCalibrationStore((s) => s.isRecognized);
  const liveAngle = useCalibrationStore((s) => s.liveAngle);
  const capturedAngles = useCalibrationStore((s) => s.capturedAngles);
  const romProfile = useCalibrationStore((s) => s.romProfile);
  const currentUserId = useCalibrationStore((s) => s.currentUserId);
  const userProfiles = useCalibrationStore((s) => s.userProfiles);
  const setPhase = useCalibrationStore((s) => s.setPhase);
  const nextPhase = useCalibrationStore((s) => s.nextPhase);
  const switchUser = useCalibrationStore((s) => s.switchUser);
  const resetCalibration = useCalibrationStore((s) => s.resetCalibration);

  const navigate = useNavigate();
  const prevPhaseRef = useRef(phase);

  // Activate mock data for calibration
  useCalibrationMock();

  // Sound effects on phase transitions
  useEffect(() => {
    if (prevPhaseRef.current !== phase) {
      if (phase === 'complete') {
        playBeep(880, 0.3);
      } else if (CAPTURE_PHASES.includes(phase)) {
        playBeep(440, 0.15);
      }
      prevPhaseRef.current = phase;
    }
  }, [phase]);

  // Start calibration if idle
  useEffect(() => {
    if (phase === 'idle') {
      setPhase('intro');
    }
  }, [phase, setPhase]);

  const handleNext = useCallback(() => {
    nextPhase();
  }, [nextPhase]);

  const handleSwitchUser = useCallback(() => {
    const otherUser = currentUserId === 'user_1' ? 'user_2' : 'user_1';
    resetCalibration();
    // Small delay so state clears, then switch
    setTimeout(() => switchUser(otherUser), 50);
  }, [currentUserId, resetCalibration, switchUser]);

  const handleRestart = useCallback(() => {
    resetCalibration();
    setTimeout(() => setPhase('intro'), 50);
  }, [resetCalibration, setPhase]);

  const currentAccentColor =
    userProfiles[currentUserId]?.accentColor ?? '#00ccff';

  const isCapture = CAPTURE_PHASES.includes(phase);
  const completedCount = CAPTURE_PHASES.filter(
    (p) => (capturedAngles[p] ?? 0) > 0
  ).length;
  const progress = phase === 'complete' ? 1 : completedCount / CAPTURE_PHASES.length;

  return (
    <div style={styles.container}>
      {/* Dark grid background */}
      <div style={styles.gridBg} />

      {/* Top bar */}
      <div style={styles.topBar}>
        <div style={styles.userBadge}>
          <div
            style={{
              ...styles.userDot,
              backgroundColor: currentAccentColor,
            }}
          />
          <span style={styles.userId}>{currentUserId}</span>
        </div>
        <button onClick={handleSwitchUser} style={styles.switchBtn}>
          Switch User
        </button>
      </div>

      {/* Recognition indicator — visible during all capture phases */}
      {(isCapture || phase === 'intro') && (
        <div style={styles.recognitionWrap}>
          <RecognitionIndicator recognized={isRecognized} />
        </div>
      )}

      {/* Overall progress bar */}
      <div style={styles.progressBarContainer}>
        <motion.div
          style={styles.progressBarFill}
          animate={{
            width: `${progress * 100}%`,
            backgroundColor:
              progress < 0.5
                ? '#00ccff'
                : progress < 1
                  ? '#44ddaa'
                  : '#00ff88',
          }}
          transition={{ duration: 0.3 }}
        />
      </div>

      {/* Main content area */}
      <AnimatePresence mode="wait">
        <motion.div
          key={phase}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.25 }}
          style={styles.content}
        >
          <h1 style={styles.heading}>{PHASE_LABELS[phase]}</h1>

          {/* Intro screen */}
          {phase === 'intro' && (
            <div style={styles.centeredCol}>
              <p style={styles.instruction}>{PHASE_INSTRUCTIONS.intro}</p>
              <SkeletonPlaceholder />
              <button onClick={handleNext} style={styles.primaryBtn}>
                Begin Calibration
              </button>
            </div>
          )}

          {/* Capture phases */}
          {isCapture && (
            <div style={styles.centeredCol}>
              <p style={styles.instruction}>{PHASE_INSTRUCTIONS[phase]}</p>
              <div style={styles.captureLayout}>
                <SkeletonPlaceholder />
                <div style={styles.arcColumn}>
                  <ROMProgressArc
                    angle={liveAngle}
                    color={currentAccentColor}
                    size={220}
                  />
                  <div style={styles.phaseProgress}>
                    {CAPTURE_PHASES.map((p, i) => (
                      <div
                        key={p}
                        style={{
                          ...styles.phaseDot,
                          backgroundColor:
                            CAPTURE_PHASES.indexOf(phase) > i
                              ? '#00ff88'
                              : CAPTURE_PHASES.indexOf(phase) === i
                                ? currentAccentColor
                                : 'rgba(255,255,255,0.2)',
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
              <button
                onClick={handleNext}
                style={{
                  ...styles.primaryBtn,
                  opacity: liveAngle > 0.05 ? 1 : 0.5,
                }}
              >
                {CAPTURE_PHASES.indexOf(phase) < CAPTURE_PHASES.length - 1
                  ? 'Next Joint →'
                  : 'Complete Calibration'}
              </button>
            </div>
          )}

          {/* Complete screen */}
          {phase === 'complete' && romProfile && (
            <div style={styles.centeredCol}>
              <div style={styles.completeGrid}>
                <ROMCard
                  label="Shoulder Flexion"
                  value={romProfile.maxFlexion}
                  color="#00ccff"
                />
                <ROMCard
                  label="Shoulder Abduction"
                  value={romProfile.maxAbduction}
                  color="#44ddaa"
                />
                <ROMCard
                  label="Elbow"
                  value={romProfile.maxExtension}
                  color="#ffcc00"
                />
                <ROMCard
                  label="Wrist"
                  value={Math.round(
                    (capturedAngles['wrist'] ?? 0) * 180
                  )}
                  color="#cc44ff"
                />
              </div>
              <p style={styles.completeSub}>
                ROM envelope captured successfully. Ready for exercises.
              </p>
              <div style={styles.btnRow}>
                <button onClick={handleRestart} style={styles.secondaryBtn}>
                  Recalibrate
                </button>
                <button onClick={handleSwitchUser} style={styles.secondaryBtn}>
                  Switch User
                </button>
                <button
                  onClick={() => navigate('/exercise/target-reach')}
                  style={styles.primaryBtn}
                >
                  Target Reach →
                </button>
                <button
                  onClick={() => navigate('/exercise/trajectory-trace')}
                  style={styles.primaryBtn}
                >
                  Trajectory Trace →
                </button>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function SkeletonPlaceholder() {
  return (
    <div style={styles.skeletonBox}>
      <svg
        width="120"
        height="160"
        viewBox="0 0 120 160"
        style={{ opacity: 0.3 }}
      >
        {/* Head */}
        <circle cx="60" cy="20" r="12" fill="#00ccff" />
        {/* Body */}
        <line
          x1="60" y1="32" x2="60" y2="90"
          stroke="#00ccff" strokeWidth="2"
        />
        {/* Arms */}
        <line
          x1="60" y1="50" x2="30" y2="75"
          stroke="#00ccff" strokeWidth="2"
        />
        <line
          x1="60" y1="50" x2="90" y2="75"
          stroke="#00ccff" strokeWidth="2"
        />
        {/* Legs */}
        <line
          x1="60" y1="90" x2="40" y2="140"
          stroke="#00ccff" strokeWidth="2"
        />
        <line
          x1="60" y1="90" x2="80" y2="140"
          stroke="#00ccff" strokeWidth="2"
        />
      </svg>
      <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>
        Skeleton Overlay
      </span>
    </div>
  );
}

function ROMCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.3 }}
      style={{
        ...styles.romCard,
        borderColor: color,
        boxShadow: `0 0 12px ${color}33`,
      }}
    >
      <div style={{ ...styles.romValue, color }}>{value}°</div>
      <div style={styles.romLabel}>{label}</div>
    </motion.div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'fixed',
    inset: 0,
    background: '#0a0a0f',
    color: '#fff',
    fontFamily: 'ui-monospace, Consolas, monospace',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  gridBg: {
    position: 'absolute',
    inset: 0,
    backgroundImage:
      'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
    backgroundSize: '40px 40px',
    pointerEvents: 'none',
  },
  topBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 24px',
    zIndex: 10,
  },
  userBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  userDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
  },
  userId: {
    fontSize: 14,
    opacity: 0.7,
  },
  switchBtn: {
    background: 'rgba(255,255,255,0.1)',
    border: '1px solid rgba(255,255,255,0.2)',
    color: '#fff',
    padding: '6px 16px',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 13,
  },
  recognitionWrap: {
    position: 'absolute',
    top: 60,
    left: 24,
    zIndex: 10,
  },
  progressBarContainer: {
    height: 3,
    background: 'rgba(255,255,255,0.08)',
    position: 'relative',
    zIndex: 10,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 2,
  },
  content: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px 32px',
    zIndex: 5,
    position: 'relative',
  },
  heading: {
    fontSize: 32,
    fontWeight: 700,
    margin: '0 0 16px',
    letterSpacing: '-0.5px',
  },
  instruction: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.6)',
    maxWidth: 500,
    textAlign: 'center',
    lineHeight: 1.5,
    margin: '0 0 32px',
  },
  centeredCol: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 16,
  },
  captureLayout: {
    display: 'flex',
    alignItems: 'center',
    gap: 48,
    marginBottom: 24,
  },
  arcColumn: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 16,
  },
  phaseProgress: {
    display: 'flex',
    gap: 8,
  },
  phaseDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    transition: 'background-color 0.2s',
  },
  skeletonBox: {
    width: 200,
    height: 240,
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 12,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    background: 'rgba(255,255,255,0.02)',
  },
  primaryBtn: {
    background: 'linear-gradient(135deg, #00ccff, #00ff88)',
    border: 'none',
    color: '#000',
    padding: '12px 32px',
    borderRadius: 8,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 15,
    fontWeight: 700,
    transition: 'transform 0.1s',
  },
  secondaryBtn: {
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.3)',
    color: '#fff',
    padding: '12px 32px',
    borderRadius: 8,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 15,
    fontWeight: 500,
  },
  btnRow: {
    display: 'flex',
    gap: 16,
    marginTop: 16,
  },
  completeGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 16,
    marginBottom: 16,
  },
  romCard: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid',
    borderRadius: 12,
    padding: '20px 28px',
    textAlign: 'center',
  },
  romValue: {
    fontSize: 36,
    fontWeight: 700,
    lineHeight: 1,
    marginBottom: 6,
  },
  romLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
  },
  completeSub: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
  },
};
