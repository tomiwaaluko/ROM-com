import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from 'recharts';
import { useCalibrationStore } from '../../stores/calibrationStore';
import { useWebSocketStore } from '../../stores/websocketStore';
import { mockROMData, fullROMData } from '../../utils/mockDashboardData';

export function ROMEnvelopeChart() {
  const romProfile = useCalibrationStore((s) => s.romProfile);
  const isMockMode = useWebSocketStore((s) => s.isMockMode);

  // Use live calibration data only outside mock mode; mock mode keeps seeded dashboard defaults.
  const patient = !isMockMode && romProfile
    ? {
        shoulderFlex: romProfile.maxFlexion,
        shoulderAbd: romProfile.maxAbduction,
        elbowExt: romProfile.maxExtension,
        wristFlex: 65,
        wristExt: 55,
      }
    : mockROMData;

  const data = [
    { axis: 'Shoulder Flex', patient: patient.shoulderFlex, full: fullROMData.shoulderFlex },
    { axis: 'Shoulder Abd', patient: patient.shoulderAbd, full: fullROMData.shoulderAbd },
    { axis: 'Elbow Ext', patient: patient.elbowExt, full: fullROMData.elbowExt },
    { axis: 'Wrist Flex', patient: patient.wristFlex, full: fullROMData.wristFlex },
    { axis: 'Wrist Ext', patient: patient.wristExt, full: fullROMData.wristExt },
  ];

  return (
    <div style={styles.card}>
      <div style={styles.title}>ROM Envelope</div>
      <ResponsiveContainer width="100%" height={220}>
        <RadarChart data={data} cx="50%" cy="50%" outerRadius="70%">
          <PolarGrid stroke="#1e2d42" />
          <PolarAngleAxis
            dataKey="axis"
            tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }}
          />
          <PolarRadiusAxis
            angle={90}
            domain={[0, 180]}
            tick={{ fill: 'rgba(255,255,255,0.25)', fontSize: 9 }}
            stroke="#1e2d42"
          />
          {/* Full ROM — dim background */}
          <Radar
            name="Full ROM"
            dataKey="full"
            stroke="#1e2d42"
            fill="#1e2d42"
            fillOpacity={0.5}
          />
          {/* Patient ROM — cyan */}
          <Radar
            name="Patient ROM"
            dataKey="patient"
            stroke="#00d4ff"
            fill="#00d4ff"
            fillOpacity={0.4}
          />
        </RadarChart>
      </ResponsiveContainer>
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
    marginBottom: 8,
  },
};
