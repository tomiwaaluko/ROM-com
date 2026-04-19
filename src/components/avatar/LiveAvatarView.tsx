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

/**
 * LiveAvatarView
 *
 * LITE mode: bring-your-own voice.
 *  1. POST /avatar/start → {session_id, livekit_url, livekit_client_token, ws_url}
 *  2. Connect to LiveKit room → render remote video track
 *  3. Connect to LiveAvatar ws_url → send agent.speak events with PCM audio
 *  4. When backend sends avatar_response text:
 *       a. fetch /avatar/synthesize → get base64 PCM 24kHz audio
 *       b. send over ws_url as {type:"agent.speak", audio:<b64>}
 *       c. follow with {type:"agent.speak_end"}
 *  5. On unmount: close both sockets + POST /avatar/stop
 */
export function LiveAvatarView() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const roomRef = useRef<Room | null>(null);
  const commandWsRef = useRef<WebSocket | null>(null);
  const commandReadyRef = useRef<boolean>(false);

  const [errMsg, setErrMsg] = useState<string | null>(null);
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
  const wsSend = useWebSocketStore((s) => s.send);

  useEffect(() => {
    if (wsStatus === 'disconnected') wsConnect();
  }, [wsStatus, wsConnect]);

  // ── Mount: start session, connect LiveKit room, open command WebSocket ──
  useEffect(() => {
    let cancelled = false;

    async function start() {
      setStatus('starting');
      setErrMsg(null);
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
            // Browsers often block autoplay — try to play explicitly and
            // surface a click-to-unmute hint if blocked.
            audioEl.play().catch((err) => {
              console.warn('[Avatar] audio autoplay blocked:', err);
              setNeedsUnmute(true);
            });
          }
        });

        room.on(RoomEvent.Disconnected, () => setStatus('stopped'));

        await room.connect(sess.livekit_url, sess.livekit_client_token);
        if (cancelled) {
          await room.disconnect();
          return;
        }

        // ── Open LiveAvatar command WebSocket (ws_url) ────────────────
        if (sess.ws_url) {
          const cmdWs = new WebSocket(sess.ws_url);
          commandWsRef.current = cmdWs;

          cmdWs.onopen = () => {
            console.log('[Avatar] command WS open');
          };
          cmdWs.onmessage = (ev) => {
            try {
              const msg = JSON.parse(ev.data);
              if (msg.type === 'session.state_updated' && msg.state === 'connected') {
                commandReadyRef.current = true;
                console.log('[Avatar] command WS ready');
              } else {
                console.debug('[Avatar] command WS message:', msg);
              }
            } catch {
              // non-JSON frames just ignore
            }
          };
          cmdWs.onerror = (e) => console.warn('[Avatar] command WS error:', e);
          cmdWs.onclose = () => {
            commandReadyRef.current = false;
            console.log('[Avatar] command WS closed');
          };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[Avatar] start failed:', msg);
        setErrMsg(msg);
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
        try { cmdWs.close(); } catch {}
        commandWsRef.current = null;
      }
      if (room) {
        room.disconnect().catch(() => {});
        roomRef.current = null;
      }
      if (currentSession) {
        fetch(`${BACKEND_URL}/avatar/stop`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: currentSession.session_id }),
        }).catch(() => {});
      }
      reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Synthesize + stream audio whenever new avatar text arrives ────────
  useEffect(() => {
    if (!lastAvatarText) return;
    if (!commandReadyRef.current || !commandWsRef.current) {
      console.warn('[Avatar] command WS not ready, cannot speak');
      return;
    }
    let cancelled = false;

    (async () => {
      setStatus('speaking');
      try {
        const res = await fetch(`${BACKEND_URL}/avatar/synthesize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: lastAvatarText }),
        });
        if (!res.ok) throw new Error(`synthesize returned ${res.status}`);
        const { audio_b64 } = await res.json();
        if (cancelled) return;

        const ws = commandWsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          console.warn('[Avatar] command WS closed before send');
          return;
        }

        // Chunk the base64 into ~1-second pieces (LiveAvatar recommends ~1MB max per packet)
        // 24000 samples/sec * 2 bytes/sample = 48000 bytes/sec PCM
        // base64 inflates by ~33%, so ~64000 b64 chars per second of audio
        const CHUNK_B64_SIZE = 64000;
        const eventId = `speak_${Date.now()}`;
        for (let i = 0; i < audio_b64.length; i += CHUNK_B64_SIZE) {
          const chunk = audio_b64.slice(i, i + CHUNK_B64_SIZE);
          ws.send(JSON.stringify({ type: 'agent.speak', audio: chunk }));
        }
        ws.send(JSON.stringify({ type: 'agent.speak_end', event_id: eventId }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[Avatar] speak failed:', msg);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [lastAvatarText, setStatus]);

  const triggerStage = (stage: string, section_name?: string) => {
    const session_id = session?.session_id;
    if (!session_id) return;
    const payload: Record<string, unknown> = { stage, session_id };
    if (section_name) payload.section_name = section_name;
    wsSend({ type: 'avatar_narrate', payload });
  };

  const triggerPatientSpeech = (text: string) => {
    wsSend({ type: 'patient_speech', payload: { text } });
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center py-6 px-4">
      <h1 className="text-2xl font-semibold mb-2">KineticLab · Live Avatar</h1>
      <div className="text-xs uppercase tracking-widest text-neutral-400 mb-4">
        status: <span className="text-white">{status}</span>
      </div>

      <div className="relative w-[640px] max-w-full aspect-video bg-neutral-900 rounded-2xl overflow-hidden shadow-xl">
        <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
        {status !== 'connected' && status !== 'speaking' && (
          <div className="absolute inset-0 flex items-center justify-center text-neutral-500 text-sm">
            {status === 'error'
              ? `Error: ${errMsg ?? 'unknown'}`
              : status === 'stopped'
              ? 'Session ended'
              : 'Starting avatar session…'}
          </div>
        )}
      </div>

      {lastAvatarText && (
        <div className="mt-4 max-w-[640px] text-sm text-neutral-300 italic text-center">
          &ldquo;{lastAvatarText}&rdquo;
        </div>
      )}

      {needsUnmute && (
        <button
          onClick={() => {
            document.querySelectorAll('audio').forEach((el) => {
              (el as HTMLAudioElement).play().catch(() => {});
            });
            setNeedsUnmute(false);
          }}
          className="mt-4 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-sm font-medium"
        >
          🔊 Click to enable avatar audio
        </button>
      )}
      <div className="flex flex-wrap gap-2 mt-6 justify-center max-w-[640px]">
        <button onClick={() => triggerStage('welcome')} className="px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-sm">
          Welcome
        </button>
        <button onClick={() => triggerStage('calibration_intro')} className="px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-sm">
          Calibration intro
        </button>
        <button onClick={() => triggerStage('calibration_section_start', 'right shoulder')} className="px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-sm">
          Section: right shoulder
        </button>
        <button onClick={() => triggerStage('score_high')} className="px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-sm">
          Score: high
        </button>
        <button onClick={() => triggerStage('score_asymmetric')} className="px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-sm">
          Score: asymmetric
        </button>
        <button onClick={() => triggerStage('session_close')} className="px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-sm">
          Close session
        </button>
        <button
          onClick={() => triggerPatientSpeech('I feel really discouraged today. I do not want to do this.')}
          className="px-3 py-2 rounded-lg bg-indigo-700 hover:bg-indigo-600 text-sm"
        >
          Patient: &ldquo;I feel discouraged&rdquo;
        </button>
      </div>
    </div>
  );
}
