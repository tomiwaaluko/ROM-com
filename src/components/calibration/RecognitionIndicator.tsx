import { motion } from 'framer-motion';

interface RecognitionIndicatorProps {
  recognized: boolean;
}

export function RecognitionIndicator({ recognized }: RecognitionIndicatorProps) {
  return (
    <div
      data-testid="recognition-status"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 16px',
        borderRadius: 8,
        background: 'rgba(0,0,0,0.4)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <motion.div
        animate={{
          backgroundColor: recognized ? '#00ff88' : '#ff4444',
          boxShadow: recognized
            ? [
                '0 0 8px #00ff88, 0 0 20px rgba(0,255,136,0.4)',
                '0 0 12px #00ff88, 0 0 30px rgba(0,255,136,0.6)',
                '0 0 8px #00ff88, 0 0 20px rgba(0,255,136,0.4)',
              ]
            : '0 0 6px #ff4444, 0 0 12px rgba(255,68,68,0.3)',
        }}
        transition={{
          backgroundColor: { duration: 0.05 },
          boxShadow: recognized
            ? { duration: 1.2, repeat: Infinity, ease: 'easeInOut' }
            : { duration: 0.05 },
        }}
        style={{
          width: 14,
          height: 14,
          borderRadius: '50%',
        }}
      />
      <span
        style={{
          fontFamily: 'ui-monospace, Consolas, monospace',
          fontSize: 13,
          fontWeight: 600,
          color: recognized ? '#00ff88' : '#ff4444',
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
        }}
      >
        {recognized ? 'Recognized' : 'Not Recognized'}
      </span>
    </div>
  );
}
