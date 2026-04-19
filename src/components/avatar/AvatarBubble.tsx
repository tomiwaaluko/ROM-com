import { useEffect, useRef, useState } from 'react';
import {
  Room,
  RoomEvent,
  RemoteTrack,
  Track,
  RemoteParticipant,
} from 'livekit-client';
import { useAvatarStore } from '../../stores/avatarStore';
import { useWebSocketStore } from '../../stores/websocketStore';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';

export type AvatarBubblePosition = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';

interface AvatarBubbleProps {
  /** Where to anchor the bubble. Default 'top-right'. */
  position?: AvatarBubblePosition;
  /** Width in px. Default 280. */
  width?: number;
  /** Height in px. Default 160. */
  height?: number;
  /** Hide the caption text. Default false. */
  hideCaption?: boolean;
}

/**
 * AvatarBubble
 *
 * Floating corner-bubble rendering Kai (LiveAvatar) with audio via the TTS bridge.
 * Session lifecycle and audio streaming are owned by this component — each page just
 * mounts it and fires avatar_narrate/patient_speech messages on its own WebSocket store.
 *
 * Drop it at the top of any page's render. Place ONCE per page — each instance creates
 * its own LiveAvatar session (burns credits). Use context if we ever need nested.
 */
export function AvatarBubble({
  position = 'top-right',
  width = 280,
  height = 160,
  hideCaption = false,
}: AvatarBubbleProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const roomRef = useRef<Room | null>(null);
  const commandWsRef = useRef<WebSocket | null>(null);
  const commandReadyRef = useRef<boolean>(false);

  const [needsUnmute, setNeedsUnmute] = useState(false);

  const session = useAvatarStore((s) => s.session);
  const status = useAvatarStore((s) => s.status);
  const lastAvatarText = useAvatarStore((s) => s.lastAvatarText);
  const setSession = useAvatarStore((s) => s.setSession);
  const setStatus = useAvatarStore((s) => s.setStatus);
  const setError = useAvatarStore((s) => s.setError);
  const reset = useAvatarStore((s) => s.reset);

  const wsStatus = useWebSocketStore((s) => s.status);
  const wsConnect = useWebSocketStore((s) => s.connect);

  useEffect(() => {
    if (wsStatus === 'disconnected') wsConnect();
  }, [wsStatus, wsConnect]);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      setStatus('starting');
      try {
        const res = await fetch(`${BACKEND_URL}/avatar/start`, { method: 'POST' });
        if (!res.ok) throw new Error(`/avatar/start returned ${res.status}`);
        const sess = await res.json();
        if (cancelled) return;
        setSession(sess);

        setStatus('connecting');
        const room = new Room();
        roomRef.current = room;

        room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, _participant: RemoteParticipant) => {
          if (track.kind === Track.Kind.Video && videoRef.current) {
            track.attach(videoRef.current);
            setStatus('connected');
          }
          if (track.kind === Track.Kind.Audio) {
            const audioEl = document.createElement('audio');
            audioEl.autoplay = true;
            audioEl.setAttribute('playsinline', 'true');
            track.attach(audioEl);
            document.body.appendChild(audioEl);
            audioEl.play().catch(() => setNeedsUnmute(true));
          }
        });

        room.on(RoomEvent.Disconnected, () => setStatus('stopped'));

        await room.connect(sess.livekit_url, sess.livekit_client_token);
        if (cancelled) {
          await room.disconnect();
          return;
        }

        if (sess.ws_url) {
          const cmdWs = new WebSocket(sess.ws_url);
          commandWsRef.current = cmdWs;
          cmdWs.onmessage = (ev) => {
            try {
              const msg = JSON.parse(ev.data);
              if (msg.type === 'session.state_updated' && msg.state === 'connected') {
                commandReadyRef.current = true;
              }
            } catch { /* ignore */ }
          };
          cmdWs.onclose = () => { commandReadyRef.current = false; };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[AvatarBubble] start failed:', msg);
        setError(msg);
      }
    }

    start();

    return () => {
      cancelled = true;
      const room = roomRef.current;
      const cmdWs = commandWsRef.current;
      const currentSession = useAvatarStore.getState().session;
      if (cmdWs) {
        try { cmdWs.close(); } catch { /* ignore */ }
        commandWsRef.current = null;
      }
      if (room) {
        room.disconnect().catch(() => { /* ignore */ });
        roomRef.current = null;
      }
      if (currentSession) {
        fetch(`${BACKEND_URL}/avatar/stop`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: currentSession.session_id }),
        }).catch(() => { /* ignore */ });
      }
      reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Synthesize + stream audio whenever new avatar text arrives ────────
  useEffect(() => {
    if (!lastAvatarText) return;
    if (!commandReadyRef.current || !commandWsRef.current) return;

    let cancelled = false;
    (async () => {
      setStatus('speaking');
      try {
        const res = await fetch(`${BACKEND_URL}/avatar/synthesize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: lastAvatarText }),
        });
        if (!res.ok) return;
        const { audio_b64 } = await res.json();
        if (cancelled) return;

        const ws = commandWsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        const CHUNK_B64_SIZE = 64000;
        const eventId = `speak_${Date.now()}`;
        for (let i = 0; i < audio_b64.length; i += CHUNK_B64_SIZE) {
          ws.send(JSON.stringify({ type: 'agent.speak', audio: audio_b64.slice(i, i + CHUNK_B64_SIZE) }));
        }
        ws.send(JSON.stringify({ type: 'agent.speak_end', event_id: eventId }));
      } catch (err) {
        console.error('[AvatarBubble] speak failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [lastAvatarText, setStatus]);

  // ── Position styling ──────────────────────────────────────────────────
  const posStyles: Record<AvatarBubblePosition, React.CSSProperties> = {
    'top-right': { top: 16, right: 16 },
    'top-left': { top: 16, left: 16 },
    'bottom-right': { bottom: 16, right: 16 },
    'bottom-left': { bottom: 16, left: 16 },
  };

  void session; // acknowledge — used internally via store

  return (
    <div
      style={{
        position: 'fixed',
        ...posStyles[position],
        width,
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        alignItems: 'flex-end',
      }}
    >
      <div
        style={{
          width,
          height,
          borderRadius: 12,
          overflow: 'hidden',
          background: '#111',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          border: '2px solid rgba(255,255,255,0.15)',
          position: 'relative',
        }}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
        {status !== 'connected' && status !== 'speaking' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10,
              color: 'rgba(255,255,255,0.5)',
              background: 'rgba(0,0,0,0.4)',
            }}
          >
            {status === 'error' ? 'Error' : status === 'stopped' ? 'Stopped' : 'Kai is joining…'}
          </div>
        )}
      </div>

      {needsUnmute && (
        <button
          onClick={() => {
            document.querySelectorAll('audio').forEach((el) => {
              (el as HTMLAudioElement).play().catch(() => { /* ignore */ });
            });
            setNeedsUnmute(false);
          }}
          style={{
            fontSize: 11,
            background: '#d97706',
            color: '#fff',
            border: 'none',
            padding: '6px 10px',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          🔊 Enable audio
        </button>
      )}

      {!hideCaption && lastAvatarText && (
        <div
          style={{
            fontSize: 11,
            color: 'rgba(255,255,255,0.7)',
            fontStyle: 'italic',
            maxWidth: width,
            background: 'rgba(0,0,0,0.55)',
            padding: '6px 10px',
            borderRadius: 6,
            lineHeight: 1.3,
          }}
        >
          &ldquo;{lastAvatarText}&rdquo;
        </div>
      )}
    </div>
  );
}
