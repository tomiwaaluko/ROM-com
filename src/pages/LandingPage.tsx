'use client';
import { useRef, useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  motion,
  useMotionValue,
  useTransform,
  useSpring,
  AnimatePresence,
  useInView,
  useScroll,
  useMotionTemplate,
} from 'framer-motion';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/* ─── Spring presets ─────────────────────────────────── */
const SPRING_SNAPPY = { type: 'spring', stiffness: 260, damping: 22 } as const;
const SPRING_SOFT   = { type: 'spring', stiffness: 100, damping: 20 } as const;
const SPRING_LAZY   = { type: 'spring', stiffness: 60,  damping: 18 } as const;

const fadeUp = {
  hidden:  { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0, transition: SPRING_SOFT },
};
const stagger = (delay = 0.08) => ({
  hidden:  {},
  visible: { transition: { staggerChildren: delay } },
});

/* ─── Magnetic button hook ───────────────────────────── */
function useMagnetic(strength = 0.35) {
  const ref = useRef<HTMLElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, SPRING_SNAPPY);
  const sy = useSpring(y, SPRING_SNAPPY);

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    x.set((e.clientX - r.left - r.width  / 2) * strength);
    y.set((e.clientY - r.top  - r.height / 2) * strength);
  }, [x, y, strength]);

  const onMouseLeave = useCallback(() => { x.set(0); y.set(0); }, [x, y]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener('mousemove', onMouseMove as EventListener);
    el.addEventListener('mouseleave', onMouseLeave);
    return () => {
      el.removeEventListener('mousemove', onMouseMove as EventListener);
      el.removeEventListener('mouseleave', onMouseLeave);
    };
  }, [onMouseMove, onMouseLeave]);

  return { ref, style: { x: sx, y: sy } };
}

/* ─── 3D Hero Canvas ─────────────────────────────────── */
function ArmOrb() {
  const groupRef = useRef<THREE.Group>(null);
  const ring1Ref = useRef<THREE.Mesh>(null);
  const ring2Ref = useRef<THREE.Mesh>(null);
  const ring3Ref = useRef<THREE.Mesh>(null);
  const particlesRef = useRef<THREE.Points>(null);

  const particlePositions = useRef<Float32Array | null>(null);
  useEffect(() => {
    const count = 180;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const phi   = Math.acos(-1 + (2 * i) / count);
      const theta = Math.sqrt(count * Math.PI) * phi;
      const r = 1.4 + Math.random() * 0.3;
      pos[i * 3]     = r * Math.cos(theta) * Math.sin(phi);
      pos[i * 3 + 1] = r * Math.sin(theta) * Math.sin(phi);
      pos[i * 3 + 2] = r * Math.cos(phi);
    }
    particlePositions.current = pos;
  }, []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (groupRef.current)   groupRef.current.rotation.y   = t * 0.18;
    if (ring1Ref.current)   ring1Ref.current.rotation.z   = t * 0.5;
    if (ring2Ref.current)   ring2Ref.current.rotation.x   = t * 0.32;
    if (ring3Ref.current) {
      ring3Ref.current.rotation.y = t * 0.22;
      ring3Ref.current.rotation.z = t * 0.11;
    }
    if (particlesRef.current) particlesRef.current.rotation.y = -t * 0.08;
  });

  return (
    <group ref={groupRef}>
      {/* Core sphere */}
      <mesh>
        <sphereGeometry args={[0.55, 48, 48]} />
        <meshStandardMaterial
          color="#00D4FF"
          emissive="#00D4FF"
          emissiveIntensity={0.4}
          roughness={0.15}
          metalness={0.8}
          transparent
          opacity={0.85}
        />
      </mesh>

      {/* Inner glow */}
      <mesh>
        <sphereGeometry args={[0.6, 32, 32]} />
        <meshStandardMaterial
          color="#00D4FF"
          emissive="#00D4FF"
          emissiveIntensity={0.15}
          transparent
          opacity={0.12}
          side={THREE.BackSide}
        />
      </mesh>

      {/* Orbital rings */}
      <mesh ref={ring1Ref}>
        <torusGeometry args={[0.9, 0.012, 8, 80]} />
        <meshStandardMaterial color="#00D4FF" emissive="#00D4FF" emissiveIntensity={0.8} />
      </mesh>
      <mesh ref={ring2Ref} rotation={[Math.PI / 3, 0, 0]}>
        <torusGeometry args={[1.15, 0.008, 8, 80]} />
        <meshStandardMaterial color="#10B981" emissive="#10B981" emissiveIntensity={0.7} transparent opacity={0.7} />
      </mesh>
      <mesh ref={ring3Ref} rotation={[Math.PI / 5, Math.PI / 4, 0]}>
        <torusGeometry args={[1.32, 0.005, 8, 80]} />
        <meshStandardMaterial color="#00D4FF" emissive="#00D4FF" emissiveIntensity={0.4} transparent opacity={0.4} />
      </mesh>

      {/* Fibonacci particles */}
      {particlePositions.current && (
        <points ref={particlesRef}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[particlePositions.current, 3]}
            />
          </bufferGeometry>
          <pointsMaterial size={0.018} color="#00D4FF" transparent opacity={0.55} sizeAttenuation />
        </points>
      )}
    </group>
  );
}

function HeroCanvas() {
  return (
    <Canvas
      camera={{ position: [0, 0, 3.5], fov: 45 }}
      style={{ width: '100%', height: '100%', background: 'transparent' }}
      gl={{ alpha: true, antialias: true }}
    >
      <ambientLight intensity={0.3} />
      <pointLight position={[3, 3, 3]} intensity={2.5} color="#00D4FF" />
      <pointLight position={[-3, -2, -2]} intensity={1.2} color="#10B981" />
      <ArmOrb />
    </Canvas>
  );
}

/* ─── Floating Nav ───────────────────────────────────── */
function FloatingNav() {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <motion.nav
      initial={{ y: -80, opacity: 0 }}
      animate={{ y: 0,   opacity: 1 }}
      transition={{ ...SPRING_SOFT, delay: 0.2 }}
      style={{
        position: 'fixed',
        top: 20,
        left: '50%',
        translateX: '-50%',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        background: scrolled
          ? 'rgba(9,9,11,0.88)'
          : 'rgba(17,24,39,0.72)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 100,
        padding: '10px 10px 10px 22px',
        boxShadow: scrolled ? '0 8px 40px rgba(0,0,0,0.5)' : '0 4px 24px rgba(0,0,0,0.3)',
        transition: 'background 0.3s, box-shadow 0.3s',
      }}
    >
      {/* Logo */}
      <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.02em', marginRight: 28, color: '#F9FAFB', whiteSpace: 'nowrap' }}>
        Kinetic<span style={{ color: 'var(--accent)' }}>Lab</span>
      </span>

      {/* Links */}
      {(['Exercises', 'Dashboard', 'About'] as const).map((label) => (
        <NavLink key={label} label={label} />
      ))}

      {/* CTA pill */}
      <motion.button
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.97, y: 1 }}
        onClick={() => navigate('/setup')}
        style={{
          marginLeft: 8,
          background: 'var(--accent)',
          color: '#09090B',
          fontWeight: 600,
          fontSize: 13,
          padding: '8px 18px',
          borderRadius: 100,
          letterSpacing: '-0.01em',
          whiteSpace: 'nowrap',
          cursor: 'pointer',
          border: 'none',
        }}
      >
        Start Session
      </motion.button>
    </motion.nav>
  );
}

function NavLink({ label }: { label: string }) {
  const map: Record<string, string> = {
    Exercises: '/exercise/target-reach',
    Dashboard: '/dashboard',
    About: '/',
  };
  return (
    <Link
      to={map[label]}
      style={{
        fontSize: 13,
        fontWeight: 500,
        color: 'var(--text-secondary)',
        padding: '6px 14px',
        borderRadius: 100,
        transition: 'color 0.2s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
    >
      {label}
    </Link>
  );
}

/* ─── Hero Section ───────────────────────────────────── */
function HeroSection() {
  const navigate = useNavigate();
  const btnMag = useMagnetic(0.28);

  return (
    <section
      className="hero-grid"
      style={{
        minHeight: '100dvh',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 0,
        alignItems: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Ambient background */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 60% 60% at 70% 50%, rgba(0,212,255,0.055) 0%, transparent 65%), radial-gradient(ellipse 40% 60% at 20% 80%, rgba(16,185,129,0.04) 0%, transparent 55%)',
      }} />

      {/* Left — editorial copy */}
      <motion.div
        variants={stagger()}
        initial="hidden"
        animate="visible"
        style={{
          padding: 'clamp(80px, 10vw, 120px) clamp(32px, 6vw, 80px) 80px clamp(24px, 7vw, 100px)',
          display: 'flex',
          flexDirection: 'column',
          gap: 28,
          position: 'relative',
          zIndex: 2,
        }}
      >
        {/* Badge */}
        <motion.div variants={fadeUp}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: 'var(--accent-dim)',
            border: '1px solid var(--accent-border)',
            borderRadius: 100,
            padding: '6px 14px',
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--accent)',
            letterSpacing: '0.04em',
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: 'var(--accent)',
              boxShadow: '0 0 8px var(--accent)',
              display: 'inline-block',
              animation: 'pulse 2s ease-in-out infinite',
            }} />
            Clinical AI Companion
          </span>
        </motion.div>

        {/* H1 */}
        <motion.h1
          variants={fadeUp}
          style={{
            fontSize: 'clamp(2.8rem, 4.2vw, 4.6rem)',
            fontWeight: 700,
            lineHeight: 1.08,
            letterSpacing: '-0.04em',
            color: 'var(--text-primary)',
            maxWidth: 560,
          }}
        >
          Arm recovery,{' '}
          <span style={{
            background: 'linear-gradient(90deg, var(--accent), #4DF0FF)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}>
            guided by AI
          </span>
        </motion.h1>

        {/* Sub */}
        <motion.p variants={fadeUp} style={{
          fontSize: 17,
          lineHeight: 1.65,
          color: 'var(--text-secondary)',
          maxWidth: '52ch',
        }}>
          Real-time motion capture meets clinical assessment. KineticLab tracks
          your upper-limb range of motion, scores it against the Fugl-Meyer scale,
          and delivers personalized coaching through a live avatar.
        </motion.p>

        {/* CTAs */}
        <motion.div variants={fadeUp} style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <motion.button
            ref={btnMag.ref as React.RefObject<HTMLButtonElement>}
            style={{
              ...btnMag.style,
              background: 'var(--accent)',
              color: '#09090B',
              fontWeight: 600,
              fontSize: 15,
              padding: '14px 28px',
              borderRadius: 100,
              letterSpacing: '-0.01em',
              cursor: 'pointer',
              border: 'none',
              boxShadow: '0 0 28px rgba(0,212,255,0.22)',
            }}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97, y: 1 }}
            onClick={() => navigate('/setup')}
          >
            Begin Session
          </motion.button>

          <motion.button
            whileHover={{ borderColor: 'rgba(255,255,255,0.22)', color: 'var(--text-primary)' }}
            whileTap={{ scale: 0.97, y: 1 }}
            onClick={() => navigate('/dashboard')}
            style={{
              background: 'transparent',
              color: 'var(--text-secondary)',
              fontWeight: 500,
              fontSize: 15,
              padding: '14px 28px',
              borderRadius: 100,
              letterSpacing: '-0.01em',
              cursor: 'pointer',
              border: '1px solid var(--border-strong)',
              transition: 'border-color 0.2s, color 0.2s',
            }}
          >
            Therapist View
          </motion.button>
        </motion.div>

        {/* Stats row */}
        <motion.div variants={fadeUp} style={{ display: 'flex', gap: 32, marginTop: 8 }}>
          {[
            { value: '< 2s', label: 'End-to-end latency' },
            { value: '5',    label: 'Exercise types' },
            { value: 'FMA',  label: 'Fugl-Meyer scoring' },
          ].map(({ value, label }) => (
            <div key={label}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>{value}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, letterSpacing: '0.02em' }}>{label}</div>
            </div>
          ))}
        </motion.div>
      </motion.div>

      {/* Right — 3D canvas */}
      <motion.div
        className="hero-canvas"
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ ...SPRING_LAZY, delay: 0.5 }}
        style={{
          height: '100dvh',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Faint background circle */}
        <div style={{
          position: 'absolute',
          width: 480, height: 480,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0,212,255,0.07) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />
        <HeroCanvas />
      </motion.div>

      {/* Scroll hint */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.8 }}
        style={{
          position: 'absolute', bottom: 32, left: '50%', translateX: '-50%',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
          color: 'var(--text-muted)', fontSize: 11, letterSpacing: '0.08em',
          pointerEvents: 'none',
        }}
      >
        <span>SCROLL</span>
        <motion.div
          animate={{ y: [0, 6, 0] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
          style={{ width: 1, height: 32, background: 'linear-gradient(to bottom, var(--text-muted), transparent)' }}
        />
      </motion.div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </section>
  );
}

/* ─── Marquee ────────────────────────────────────────── */
const MARQUEE_ITEMS = [
  'REAL-TIME ASR',
  '72° SHOULDER FLEXION',
  'HEYGEN LIVE AVATAR',
  'FMA-UE SCORING',
  '5-DAY STREAK',
  'ELEVENLABS TTS',
  'MEDIAPIPE TRACKING',
  '94.2% ACCURACY',
  'WHISPER / DEEPGRAM',
  'PHOTON IMESSAGE',
  'MONGODB SESSION DATA',
  '< 2s LATENCY',
];

function MarqueeSection() {
  return (
    <div style={{
      borderTop: '1px solid var(--border)',
      borderBottom: '1px solid var(--border)',
      background: 'var(--surface)',
      padding: '18px 0',
      overflow: 'hidden',
      position: 'relative',
    }}>
      <motion.div
        animate={{ x: ['0%', '-50%'] }}
        transition={{ duration: 28, ease: 'linear', repeat: Infinity }}
        style={{ display: 'flex', gap: 0, width: 'max-content', willChange: 'transform' }}
      >
        {[...MARQUEE_ITEMS, ...MARQUEE_ITEMS].map((item, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '0 28px', whiteSpace: 'nowrap' }}>
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 500, letterSpacing: '0.1em', color: 'var(--text-muted)' }}>
              {item}
            </span>
            <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--accent)', opacity: 0.5 }} />
          </div>
        ))}
      </motion.div>
    </div>
  );
}

/* ─── Bento Grid ─────────────────────────────────────── */
function BentoSection() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });

  return (
    <section ref={ref} style={{ padding: 'clamp(64px, 10vw, 120px) clamp(20px, 5vw, 64px)' }}>
      <motion.div
        variants={stagger(0.1)}
        initial="hidden"
        animate={inView ? 'visible' : 'hidden'}
        className="bento-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(12, 1fr)',
          gridAutoFlow: 'dense',
          gap: 16,
          maxWidth: 1280,
          margin: '0 auto',
        }}
      >
        {/* Card 1 — AI Companion (col 8) */}
        <BentoCard span={8} rowSpan={1} accent>
          <AvatarCard />
        </BentoCard>

        {/* Card 2 — ROM Arc (col 4) */}
        <BentoCard span={4} rowSpan={1}>
          <ROMCard />
        </BentoCard>

        {/* Card 3 — Streak (col 5) */}
        <BentoCard span={5}>
          <StreakCard />
        </BentoCard>

        {/* Card 4 — Dashboard preview (col 7) */}
        <BentoCard span={7}>
          <DashboardCard />
        </BentoCard>
      </motion.div>
    </section>
  );
}

function BentoCard({
  children, span, rowSpan = 1, accent = false,
}: {
  children: React.ReactNode;
  span: number;
  rowSpan?: number;
  accent?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const spotlightX = useSpring(mouseX, SPRING_SNAPPY);
  const spotlightY = useSpring(mouseY, SPRING_SNAPPY);
  const background = useMotionTemplate`radial-gradient(280px circle at ${spotlightX}px ${spotlightY}px, ${hovered ? 'rgba(0,212,255,0.07)' : 'rgba(0,212,255,0)'}, transparent 60%)`;

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    mouseX.set(e.clientX - r.left);
    mouseY.set(e.clientY - r.top);
  };

  return (
    <motion.div
      variants={fadeUp}
      onMouseMove={onMouseMove}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        gridColumn: `span ${span}`,
        gridRow: `span ${rowSpan}`,
        position: 'relative',
        borderRadius: 24,
        border: accent
          ? '1px solid var(--accent-border)'
          : '1px solid var(--border)',
        background: 'var(--surface)',
        overflow: 'hidden',
        minHeight: 220,
      }}
    >
      {/* Spotlight */}
      <motion.div style={{ position: 'absolute', inset: 0, borderRadius: 24, background, pointerEvents: 'none', zIndex: 0 }} />
      {/* Inner border refraction */}
      <div style={{
        position: 'absolute', inset: 0, borderRadius: 24, pointerEvents: 'none',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
      }} />
      <div style={{ position: 'relative', zIndex: 1, height: '100%' }}>
        {children}
      </div>
    </motion.div>
  );
}

/* Avatar card */
function AvatarCard() {
  const [text, setText] = useState('');
  const messages = [
    "Great work on your shoulder flexion today — you hit 72 degrees.",
    "Your 5-day streak shows real commitment. Let's build on that momentum.",
    "Your FMA domain A score improved to 26. That's meaningful progress.",
  ];
  const [msgIndex, setMsgIndex] = useState(0);

  useEffect(() => {
    let charIdx = 0;
    setText('');
    const interval = setInterval(() => {
      charIdx++;
      setText(messages[msgIndex].slice(0, charIdx));
      if (charIdx >= messages[msgIndex].length) {
        clearInterval(interval);
        setTimeout(() => {
          setMsgIndex((i) => (i + 1) % messages.length);
        }, 2800);
      }
    }, 28);
    return () => clearInterval(interval);
  }, [msgIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ padding: 32, height: '100%', display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        {/* Avatar circle */}
        <div style={{
          width: 48, height: 48, borderRadius: '50%',
          background: 'linear-gradient(135deg, var(--accent) 0%, #4DF0FF 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20, fontWeight: 700, color: '#09090B', flexShrink: 0,
        }}>
          K
        </div>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>Kai</div>
          <div style={{ fontSize: 11, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block', animation: 'pulse 1.5s ease-in-out infinite' }} />
            Live · AI Companion
          </div>
        </div>
      </div>

      {/* Chat bubble */}
      <div style={{
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: '18px 20px',
        fontSize: 15,
        lineHeight: 1.6,
        color: 'var(--text-primary)',
        minHeight: 80,
        position: 'relative',
      }}>
        {text}
        <motion.span
          animate={{ opacity: [1, 0] }}
          transition={{ duration: 0.5, repeat: Infinity, repeatType: 'reverse' }}
          style={{ display: 'inline-block', width: 2, height: '1em', background: 'var(--accent)', marginLeft: 2, verticalAlign: 'text-bottom' }}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {['ElevenLabs TTS', 'HeyGen Avatar', 'GPT-4o'].map((tag) => (
          <span key={tag} style={{
            fontSize: 11, padding: '4px 10px', borderRadius: 100,
            background: 'var(--accent-dim)', border: '1px solid var(--accent-border)',
            color: 'var(--accent)', fontFamily: 'var(--font-mono)',
          }}>{tag}</span>
        ))}
      </div>
    </div>
  );
}

/* ROM Arc card */
function ROMCard() {
  const [angle, setAngle] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => {
      let v = 0;
      const tick = setInterval(() => {
        v += 1.4;
        setAngle(Math.min(v, 72));
        if (v >= 72) clearInterval(tick);
      }, 14);
      return () => clearInterval(tick);
    }, 400);
    return () => clearTimeout(t);
  }, []);

  const r = 64;
  const cx = 80, cy = 80;
  const startAngle = -Math.PI * 0.85;
  const sweep = (angle / 180) * Math.PI * 1.5;
  const endAngle = startAngle + sweep;
  const maxAngle = startAngle + Math.PI * 1.5;

  const arcPath = (a1: number, a2: number, color: string, stroke: number) => {
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    const x2 = cx + r * Math.cos(a2);
    const y2 = cy + r * Math.sin(a2);
    const large = a2 - a1 > Math.PI ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  };

  return (
    <div style={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>SHOULDER ROM</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <svg width={160} height={160} viewBox="0 0 160 160">
          {/* Track */}
          <path d={arcPath(startAngle, maxAngle, 'none', 0)} fill="none" stroke="var(--border-strong)" strokeWidth={6} strokeLinecap="round" />
          {/* Active arc */}
          <path d={arcPath(startAngle, endAngle, 'none', 0)} fill="none" stroke="var(--accent)" strokeWidth={6} strokeLinecap="round" />
          {/* Value */}
          <text x={cx} y={cy - 4} textAnchor="middle" fill="var(--text-primary)" fontSize={26} fontFamily="var(--font-mono)" fontWeight={500}>
            {Math.round(angle)}°
          </text>
          <text x={cx} y={cy + 16} textAnchor="middle" fill="var(--text-muted)" fontSize={10} fontFamily="var(--font-sans)">
            flexion
          </text>
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            { label: 'Abduction', val: '58°', pct: 0.58 },
            { label: 'Elbow',     val: '91°', pct: 0.75 },
            { label: 'Wrist',     val: '44°', pct: 0.44 },
          ].map(({ label, val, pct }) => (
            <div key={label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{label}</span>
                <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{val}</span>
              </div>
              <div style={{ height: 3, background: 'var(--border-strong)', borderRadius: 2, overflow: 'hidden', width: 100 }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct * 100}%` }}
                  transition={{ delay: 0.6 + Math.random() * 0.4, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                  style={{ height: '100%', background: 'var(--accent)', borderRadius: 2 }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* Streak card */
function StreakCard() {
  const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const done  = [true, true, true, true, true, false, false];
  return (
    <div style={{ padding: 28, height: '100%', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>THIS WEEK</div>
      <div style={{ display: 'flex', gap: 8 }}>
        {days.map((d, i) => (
          <motion.div
            key={i}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ ...SPRING_SNAPPY, delay: 0.3 + i * 0.06 }}
            style={{
              flex: 1, paddingTop: '100%', position: 'relative',
              borderRadius: 8,
              background: done[i] ? 'var(--accent-dim)' : 'var(--surface-3)',
              border: `1px solid ${done[i] ? 'var(--accent-border)' : 'var(--border)'}`,
            }}
          >
            <span style={{
              position: 'absolute', top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
              fontSize: 10, fontWeight: 600,
              color: done[i] ? 'var(--accent)' : 'var(--text-muted)',
            }}>{d}</span>
          </motion.div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 48, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', lineHeight: 1 }}>5</span>
        <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>day streak</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} />
        FMA total: 35 pts — Moderate impairment
      </div>
    </div>
  );
}

/* Dashboard preview card */
function DashboardCard() {
  const weeks = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6'];
  const scores = [22, 26, 29, 31, 33, 35];
  const max = 66;

  return (
    <div style={{ padding: 28, height: '100%', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>FMA-UE TRAJECTORY</div>
        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--green)', background: 'var(--green-dim)', padding: '3px 10px', borderRadius: 100 }}>+13 pts</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flex: 1, paddingBottom: 8 }}>
        {scores.map((s, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <motion.div
              initial={{ scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={{ ...SPRING_SOFT, delay: 0.2 + i * 0.08 }}
              style={{
                transformOrigin: 'bottom',
                width: '100%',
                height: `${(s / max) * 120}px`,
                background: i === scores.length - 1
                  ? 'linear-gradient(to top, var(--accent), rgba(0,212,255,0.3))'
                  : 'var(--surface-3)',
                borderRadius: '4px 4px 0 0',
                border: i === scores.length - 1 ? '1px solid var(--accent-border)' : '1px solid var(--border)',
              }}
            />
            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{weeks[i]}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 16 }}>
        {[
          { label: 'Domain A', val: '26' },
          { label: 'Domain C', val: '7'  },
          { label: 'Domain E', val: '4'  },
        ].map(({ label, val }) => (
          <div key={label}>
            <div style={{ fontSize: 18, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>{val}</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Scroll-reveal feature strip ────────────────────── */
function FeatureStrip() {
  const features = [
    {
      title: 'Vision-Based Tracking',
      body: 'MediaPipe Holistic maps 21 hand landmarks and 33 pose keypoints at 30 fps — no external sensors required.',
      tag: 'MediaPipe',
    },
    {
      title: 'Clinical Scoring',
      body: 'FMA-UE subscale scores computed per session. Therapist dashboard shows domain-level trends over time.',
      tag: 'Fugl-Meyer',
    },
    {
      title: 'AI Avatar Coach',
      body: 'Whisper transcribes patient speech, GPT-4o generates clinically safe responses, HeyGen renders a live talking avatar.',
      tag: 'HeyGen + GPT-4o',
    },
    {
      title: 'iMessage Reminders',
      body: 'Photon Spectrum sends personalized daily check-ins. Replies route back to the session data layer.',
      tag: 'Photon Spectrum',
    },
  ];

  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });

  return (
    <section
      ref={ref}
      style={{
        padding: 'clamp(40px, 8vw, 96px) clamp(20px, 5vw, 64px)',
        borderTop: '1px solid var(--border)',
        maxWidth: 1280,
        margin: '0 auto',
        width: '100%',
      }}
    >
      <motion.div
        variants={stagger(0.1)}
        initial="hidden"
        animate={inView ? 'visible' : 'hidden'}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 0,
        }}
      >
        {features.map((f, i) => (
          <motion.div
            key={f.title}
            variants={fadeUp}
            style={{
              padding: '32px 28px',
              borderLeft: i > 0 ? '1px solid var(--border)' : 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <span style={{
              fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--accent)',
              background: 'var(--accent-dim)', border: '1px solid var(--accent-border)',
              padding: '3px 10px', borderRadius: 100, alignSelf: 'flex-start',
              letterSpacing: '0.06em',
            }}>{f.tag}</span>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>{f.title}</div>
            <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{f.body}</div>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}

/* ─── CTA Section ────────────────────────────────────── */
function CTASection() {
  const navigate = useNavigate();
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });
  const { scrollYProgress } = useScroll({ target: ref });
  const bgY = useTransform(scrollYProgress, [0, 1], ['0%', '-12%']);

  return (
    <section
      ref={ref}
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderTop: '1px solid var(--border)',
        margin: '0 clamp(20px, 5vw, 64px) clamp(40px, 6vw, 80px)',
        borderRadius: 32,
        background: 'var(--surface)',
      }}
    >
      {/* Parallax glow */}
      <motion.div
        style={{
          y: bgY,
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'radial-gradient(ellipse 70% 80% at 50% 50%, rgba(0,212,255,0.08) 0%, transparent 65%)',
        }}
      />

      <motion.div
        variants={stagger()}
        initial="hidden"
        animate={inView ? 'visible' : 'hidden'}
        style={{
          position: 'relative', zIndex: 1,
          padding: 'clamp(56px, 9vw, 100px) clamp(24px, 6vw, 80px)',
          textAlign: 'center',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28,
        }}
      >
        <motion.div variants={fadeUp} style={{
          fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
          letterSpacing: '0.12em', textTransform: 'uppercase',
        }}>
          Research-grade proxy · Not FDA cleared
        </motion.div>

        <motion.h2 variants={fadeUp} style={{
          fontSize: 'clamp(2rem, 4vw, 3.6rem)',
          fontWeight: 700, lineHeight: 1.1, letterSpacing: '-0.04em',
          maxWidth: '18ch', color: 'var(--text-primary)',
        }}>
          Start your first session in under 60 seconds
        </motion.h2>

        <motion.p variants={fadeUp} style={{ fontSize: 16, color: 'var(--text-secondary)', maxWidth: '48ch', lineHeight: 1.7 }}>
          Calibrate once. Exercise in any of five clinically-informed movement
          patterns. Review your progress on the therapist dashboard.
        </motion.p>

        <motion.button
          variants={fadeUp}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.97, y: 1 }}
          onClick={() => navigate('/setup')}
          style={{
            background: 'var(--accent)',
            color: '#09090B',
            fontWeight: 700,
            fontSize: 16,
            padding: '16px 36px',
            borderRadius: 100,
            cursor: 'pointer',
            border: 'none',
            letterSpacing: '-0.01em',
            boxShadow: '0 0 40px rgba(0,212,255,0.25)',
          }}
        >
          Launch KineticLab
        </motion.button>
      </motion.div>
    </section>
  );
}

/* ─── Footer ─────────────────────────────────────────── */
function Footer() {
  return (
    <footer style={{
      borderTop: '1px solid var(--border)',
      padding: '28px clamp(20px, 5vw, 64px)',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 16,
    }}>
      <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: '-0.02em', color: 'var(--text-secondary)' }}>
        Kinetic<span style={{ color: 'var(--accent)' }}>Lab</span>
      </span>

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {[
          { label: 'Calibrate',  to: '/setup' },
          { label: 'Exercises',  to: '/exercise/target-reach' },
          { label: 'Avatar',     to: '/avatar' },
          { label: 'Dashboard',  to: '/dashboard' },
        ].map(({ label, to }) => (
          <Link key={label} to={to} style={{ fontSize: 13, color: 'var(--text-muted)', transition: 'color 0.2s' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
          >
            {label}
          </Link>
        ))}
      </div>

      <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
        Built at HackATL 2026
      </span>
    </footer>
  );
}

/* ─── Page ───────────────────────────────────────────── */
export function LandingPage() {
  return (
    <main style={{ overflowX: 'hidden', width: '100%', maxWidth: '100%', background: 'var(--bg)' }}>
      <FloatingNav />
      <HeroSection />
      <MarqueeSection />
      <BentoSection />
      <FeatureStrip />
      <CTASection />
      <Footer />
    </main>
  );
}
