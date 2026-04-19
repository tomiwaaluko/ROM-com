import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useWebSocketStore } from '../../stores/websocketStore';

const MESSAGES = {
  advance: "Nice work! Difficulty increased — your targets are now 5% tighter 🎯",
  regress: "Targets adjusted — we've made it a bit easier to help you build back up 💪",
} as const;

const GRADIENTS = {
  advance: 'linear-gradient(135deg, rgba(16,185,129,0.92) 0%, rgba(5,150,105,0.92) 100%)',
  regress: 'linear-gradient(135deg, rgba(59,130,246,0.92) 0%, rgba(37,99,235,0.92) 100%)',
} as const;

const AUTO_DISMISS_MS = 4000;

export function ProgressionToast() {
  const lastProgressionUpdate = useWebSocketStore((s) => s.lastProgressionUpdate);
  const [visible, setVisible] = useState(false);
  const [action, setAction] = useState<'advance' | 'regress' | null>(null);

  useEffect(() => {
    if (!lastProgressionUpdate || lastProgressionUpdate.action === 'hold') return;

    setAction(lastProgressionUpdate.action);
    setVisible(true);

    const timer = setTimeout(() => setVisible(false), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [lastProgressionUpdate]);

  if (!action) return null;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key={lastProgressionUpdate?.timestamp}
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
          onClick={() => setVisible(false)}
          style={{
            position: 'fixed',
            top: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9999,
            background: GRADIENTS[action],
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderRadius: 14,
            padding: '14px 24px',
            maxWidth: 'min(520px, 90vw)',
            width: 'max-content',
            boxShadow: '0 8px 32px rgba(0,0,0,0.28)',
            border: '1px solid rgba(255,255,255,0.18)',
            cursor: 'pointer',
            userSelect: 'none',
          }}
          role="alert"
          aria-live="polite"
        >
          <p
            style={{
              margin: 0,
              color: '#fff',
              fontSize: 18,
              fontWeight: 600,
              lineHeight: 1.4,
              textAlign: 'center',
              textShadow: '0 1px 3px rgba(0,0,0,0.18)',
            }}
          >
            {MESSAGES[action]}
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
