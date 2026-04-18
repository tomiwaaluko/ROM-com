import { useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { mockSessionHistory } from '../../utils/mockDashboardData';
import type { MockSession } from '../../utils/mockDashboardData';

export function SessionHistoryChart() {
  const [selectedSession, setSelectedSession] = useState<MockSession | null>(null);

  const data = mockSessionHistory.map((s) => ({
    session: `#${s.sessionNumber}`,
    score: s.fmaScore.total,
    raw: s,
  }));

  return (
    <div style={styles.card}>
      <div style={styles.title}>Session History</div>

      <div style={{ filter: 'drop-shadow(0 0 6px rgba(0,212,255,0.3))' }}>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart
            data={data}
            margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
            onClick={(e) => {
              if (e?.activePayload?.[0]) {
                setSelectedSession(e.activePayload[0].payload.raw);
              }
            }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#1e2d42" />
            <XAxis
              dataKey="session"
              tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }}
              stroke="#1e2d42"
            />
            <YAxis
              domain={[0, 52]}
              tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }}
              stroke="#1e2d42"
            />
            <Tooltip
              contentStyle={{
                background: '#1a1a2e',
                border: '1px solid #1e2d42',
                borderRadius: 8,
                fontSize: 12,
                color: '#fff',
              }}
            />
            <Line
              type="monotone"
              dataKey="score"
              stroke="#00d4ff"
              strokeWidth={2.5}
              dot={{ fill: '#00d4ff', r: 4, cursor: 'pointer' }}
              activeDot={{ r: 6, fill: '#fff', stroke: '#00d4ff', strokeWidth: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Selected session breakdown */}
      {selectedSession && (
        <div style={styles.breakdown}>
          <div style={styles.breakdownTitle}>
            Session #{selectedSession.sessionNumber} — {selectedSession.date}
          </div>
          <div style={styles.breakdownGrid}>
            <div>
              <span style={styles.breakdownLabel}>Domain A</span>
              <span style={styles.breakdownVal}>{selectedSession.fmaScore.domainA}/36</span>
            </div>
            <div>
              <span style={styles.breakdownLabel}>Domain C</span>
              <span style={styles.breakdownVal}>{selectedSession.fmaScore.domainC}/10</span>
            </div>
            <div>
              <span style={styles.breakdownLabel}>Domain E</span>
              <span style={styles.breakdownVal}>{selectedSession.fmaScore.domainE}/6</span>
            </div>
            <div>
              <span style={styles.breakdownLabel}>Total</span>
              <span style={{ ...styles.breakdownVal, color: '#00d4ff' }}>
                {selectedSession.fmaScore.total}/52
              </span>
            </div>
          </div>
        </div>
      )}
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
  title: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    fontFamily: 'ui-monospace, Consolas, monospace',
    marginBottom: 12,
  },
  breakdown: {
    marginTop: 12,
    padding: 12,
    background: '#0d1117',
    borderRadius: 8,
    border: '1px solid #1e2d42',
  },
  breakdownTitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    marginBottom: 8,
    fontFamily: 'ui-monospace, Consolas, monospace',
  },
  breakdownGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8,
  },
  breakdownLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    marginRight: 8,
    fontFamily: 'ui-monospace, Consolas, monospace',
  },
  breakdownVal: {
    fontSize: 13,
    fontWeight: 700,
    color: '#fff',
    fontFamily: 'ui-monospace, Consolas, monospace',
  },
};
