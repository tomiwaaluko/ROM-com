import { mockSessionHistory } from '../../utils/mockDashboardData';

interface FMAScoreCardProps {
  currentScore: { domainA: number; domainC: number; domainE: number; total: number };
  maxScore?: number;
}

function getSeverityBand(total: number): { label: string; range: string } {
  if (total < 20) return { label: 'Severe', range: '0\u201319' };
  if (total < 48) return { label: 'Moderate', range: '20\u201347' };
  return { label: 'Mild', range: '48\u201352' };
}

export function FMAScoreCard({ currentScore, maxScore = 52 }: FMAScoreCardProps) {
  const fillPct = Math.min(100, (currentScore.total / maxScore) * 100);
  const severity = getSeverityBand(currentScore.total);

  // Delta from previous session
  const prevSession = mockSessionHistory[mockSessionHistory.length - 2];
  const delta = prevSession ? currentScore.total - prevSession.fmaScore.total : 0;
  const deltaText =
    delta > 0
      ? `+${delta} pts \u2191`
      : delta < 0
        ? `${delta} pt \u2193`
        : '\u2014';
  const deltaColor = delta > 0 ? '#00ff88' : delta < 0 ? '#ff4444' : '#888';

  const domains = [
    { label: 'A \u2014 Upper Extremity', value: currentScore.domainA, max: 36, color: '#00d4ff' },
    { label: 'C \u2014 Wrist/Hand', value: currentScore.domainC, max: 10, color: '#00ccff' },
    { label: 'E \u2014 Coordination', value: currentScore.domainE, max: 6, color: '#0099cc' },
  ];

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <span style={styles.title}>FMA-UE Score</span>
        <span style={{ ...styles.delta, color: deltaColor }}>{deltaText}</span>
      </div>

      {/* Big score */}
      <div style={styles.bigScore}>
        <span style={styles.scoreNum}>{currentScore.total}</span>
        <span style={styles.scoreMax}> / {maxScore}</span>
      </div>

      {/* Progress bar */}
      <div style={styles.barBg}>
        <div style={{ ...styles.barFill, width: `${fillPct}%` }} />
      </div>

      {/* Severity band */}
      <div style={styles.severity}>
        {severity.label} ({severity.range})
      </div>

      {/* Domain breakdown */}
      <div style={styles.domains}>
        {domains.map((d) => (
          <div key={d.label} style={styles.domainRow}>
            <span style={styles.domainLabel}>{d.label}</span>
            <div style={styles.domainBarBg}>
              <div
                style={{
                  ...styles.domainBarFill,
                  width: `${(d.value / d.max) * 100}%`,
                  background: d.color,
                }}
              />
            </div>
            <span style={styles.domainValue}>
              {d.value}/{d.max}
            </span>
          </div>
        ))}
      </div>

      {/* Disclaimer */}
      <div style={styles.disclaimer}>
        Research-grade FMA-UE subscale proxy. Not FDA-cleared.
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: '#111827',
    borderRadius: 12,
    padding: 20,
    border: '1px solid #1e2d42',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    fontFamily: 'ui-monospace, Consolas, monospace',
  },
  delta: {
    fontSize: 14,
    fontWeight: 700,
    fontFamily: 'ui-monospace, Consolas, monospace',
  },
  bigScore: {
    marginBottom: 12,
  },
  scoreNum: {
    fontSize: 48,
    fontWeight: 700,
    color: '#fff',
    fontFamily: 'ui-monospace, Consolas, monospace',
    lineHeight: 1,
  },
  scoreMax: {
    fontSize: 20,
    color: 'rgba(255,255,255,0.35)',
    fontFamily: 'ui-monospace, Consolas, monospace',
  },
  barBg: {
    height: 8,
    borderRadius: 4,
    background: '#1e2d42',
    overflow: 'hidden',
    marginBottom: 8,
  },
  barFill: {
    height: '100%',
    borderRadius: 4,
    background: '#00d4ff',
    transition: 'width 0.5s ease',
  },
  severity: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    marginBottom: 16,
    fontFamily: 'ui-monospace, Consolas, monospace',
  },
  domains: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
    marginBottom: 16,
  },
  domainRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  domainLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
    width: 140,
    flexShrink: 0,
    fontFamily: 'ui-monospace, Consolas, monospace',
  },
  domainBarBg: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    background: '#1e2d42',
    overflow: 'hidden',
  },
  domainBarFill: {
    height: '100%',
    borderRadius: 3,
    transition: 'width 0.5s ease',
  },
  domainValue: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
    width: 40,
    textAlign: 'right' as const,
    fontFamily: 'ui-monospace, Consolas, monospace',
  },
  disclaimer: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.25)',
    fontStyle: 'italic',
    fontFamily: 'ui-monospace, Consolas, monospace',
  },
};
