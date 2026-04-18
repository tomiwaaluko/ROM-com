import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useMockData } from '../../hooks/useMockData';
import { useCalibrationStore } from '../../stores/calibrationStore';
import { useSessionStore } from '../../stores/sessionStore';
import { mockSessionHistory } from '../../utils/mockDashboardData';
import { FMAScoreCard } from './FMAScoreCard';
import { SessionHistoryChart } from './SessionHistoryChart';
import { ROMEnvelopeChart } from './ROMEnvelopeChart';
import { LiveSkeletonMini } from './LiveSkeletonMini';

type Tab = 'clinical' | 'researcher';

export function TherapistDashboard() {
  const navigate = useNavigate();
  const { status, isMockMode } = useWebSocket();
  useMockData('post-calibration');

  const currentUserId = useCalibrationStore((s) => s.currentUserId);
  const switchUser = useCalibrationStore((s) => s.switchUser);
  const userProfiles = useCalibrationStore((s) => s.userProfiles);
  const fmaScore = useSessionStore((s) => s.fmaScore);

  const [activeTab, setActiveTab] = useState<Tab>('clinical');

  const latestSession = mockSessionHistory[mockSessionHistory.length - 1];
  const hasLiveFmaScore =
    fmaScore.domain_a > 0 &&
    fmaScore.domain_c > 0 &&
    fmaScore.domain_e > 0 &&
    fmaScore.total > 0;
  const currentScore = !isMockMode && hasLiveFmaScore
    ? {
        domainA: fmaScore.domain_a,
        domainC: fmaScore.domain_c,
        domainE: fmaScore.domain_e,
        total: fmaScore.total,
      }
    : latestSession.fmaScore;

  const availableUsers = Object.keys(userProfiles).length > 0
    ? Object.keys(userProfiles)
    : ['user_1', 'user_2'];

  if (status !== 'connected') {
    return (
      <div style={{ background: '#0a0d14', color: '#fff', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'ui-monospace, Consolas, monospace' }}>
        Connecting...
      </div>
    );
  }

  return (
    <div style={styles.root}>
      {/* Top bar */}
      <header style={styles.topBar}>
        <div style={styles.logo}>KineticLab</div>
        <div style={styles.topBarCenter}>
          <button
            style={activeTab === 'clinical' ? styles.tabActive : styles.tab}
            onClick={() => setActiveTab('clinical')}
          >
            Clinical
          </button>
          <button
            style={activeTab === 'researcher' ? styles.tabActive : styles.tab}
            onClick={() => setActiveTab('researcher')}
          >
            Researcher View
          </button>
        </div>
        <div style={styles.topBarRight}>
          <label style={styles.patientLabel}>
            Patient:{' '}
            <select
              value={currentUserId}
              onChange={(e) => switchUser(e.target.value)}
              style={styles.select}
            >
              {availableUsers.map((id) => (
                <option key={id} value={id}>
                  {id.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                </option>
              ))}
            </select>
          </label>
          <span style={styles.sessionBadge}>Session #{latestSession.sessionNumber}</span>
          <button style={styles.navBtn} onClick={() => navigate('/exercise/target-reach')}>
            Exercises
          </button>
          <button style={styles.navBtn} onClick={() => window.print()}>
            Print
          </button>
        </div>
      </header>

      {activeTab === 'clinical' ? (
        <div style={styles.content}>
          {/* Left column — skeleton mini */}
          <aside style={styles.leftCol}>
            <LiveSkeletonMini />
          </aside>

          {/* Right column — charts */}
          <main style={styles.rightCol}>
            <FMAScoreCard
              currentScore={{
                domainA: currentScore.domainA,
                domainC: currentScore.domainC,
                domainE: currentScore.domainE,
                total: currentScore.total,
              }}
            />
            <SessionHistoryChart />
            <ROMEnvelopeChart />
          </main>
        </div>
      ) : (
        <div style={styles.researcherView}>
          <div style={styles.researcherCard}>
            <div style={styles.researcherTitle}>Neural Activation Region</div>
            <div style={styles.brainPlaceholder}>
              <svg viewBox="0 0 200 160" width="300" height="240">
                {/* Simplified brain outline */}
                <ellipse cx="100" cy="80" rx="85" ry="65" fill="none" stroke="#1e2d42" strokeWidth="2" />
                <ellipse cx="100" cy="80" rx="60" ry="45" fill="none" stroke="#1e2d42" strokeWidth="1" />
                {/* M1 highlight region */}
                <ellipse cx="75" cy="50" rx="20" ry="15" fill="#00d4ff" opacity="0.3" stroke="#00d4ff" strokeWidth="1.5" />
                <text x="75" y="54" textAnchor="middle" fill="#00d4ff" fontSize="8" fontFamily="monospace">M1</text>
                {/* Central sulcus line */}
                <line x1="70" y1="20" x2="90" y2="140" stroke="#1e2d42" strokeWidth="1" strokeDasharray="4 4" />
              </svg>
            </div>
            <div style={styles.researcherAnnotation}>
              Primary motor cortex (M1) — engaged during shoulder flexion exercise.
              <br />
              <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>
                Source: Neurosynth meta-analysis, upper limb motor tasks
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Print styles */}
      <style>{printCSS}</style>
    </div>
  );
}

const printCSS = `
@media print {
  body { background: #fff !important; color: #000 !important; }
  header, button, select, .no-print { display: none !important; }
  div { background: transparent !important; border-color: #ccc !important; color: #000 !important; }
}
`;

const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: '100vh',
    background: '#0a0d14',
    color: '#fff',
    fontFamily: 'ui-monospace, Consolas, monospace',
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 24px',
    borderBottom: '1px solid #1e2d42',
    flexWrap: 'wrap',
    gap: 8,
  },
  logo: {
    fontSize: 18,
    fontWeight: 700,
    color: '#00d4ff',
    letterSpacing: '0.05em',
  },
  topBarCenter: {
    display: 'flex',
    gap: 4,
  },
  topBarRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  tab: {
    background: 'transparent',
    border: '1px solid #1e2d42',
    color: 'rgba(255,255,255,0.5)',
    padding: '6px 14px',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: 'ui-monospace, Consolas, monospace',
  },
  tabActive: {
    background: '#1e2d42',
    border: '1px solid #00d4ff',
    color: '#00d4ff',
    padding: '6px 14px',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: 'ui-monospace, Consolas, monospace',
  },
  patientLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
  },
  select: {
    background: '#111827',
    color: '#fff',
    border: '1px solid #1e2d42',
    borderRadius: 4,
    padding: '4px 8px',
    fontSize: 12,
    fontFamily: 'ui-monospace, Consolas, monospace',
    cursor: 'pointer',
  },
  sessionBadge: {
    fontSize: 12,
    color: '#00ff88',
    fontWeight: 600,
  },
  navBtn: {
    background: '#1e2d42',
    border: 'none',
    color: '#fff',
    padding: '6px 14px',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: 'ui-monospace, Consolas, monospace',
  },
  content: {
    display: 'flex',
    gap: 20,
    padding: 24,
    maxWidth: 1100,
    margin: '0 auto',
  },
  leftCol: {
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  rightCol: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    minWidth: 0,
  },
  researcherView: {
    padding: 24,
    maxWidth: 600,
    margin: '0 auto',
  },
  researcherCard: {
    background: '#111827',
    borderRadius: 12,
    padding: 24,
    border: '1px solid #1e2d42',
    textAlign: 'center',
  },
  researcherTitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    marginBottom: 16,
  },
  brainPlaceholder: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: 16,
  },
  researcherAnnotation: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    lineHeight: 1.6,
  },
};
