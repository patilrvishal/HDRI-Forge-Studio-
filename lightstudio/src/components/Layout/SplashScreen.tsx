import { useCallback, useEffect, useRef, useState } from 'react';
import { setIntroEnabled } from '../../utils/introPref';

/** The intro video, bundled from /public. */
const INTRO_SRC = '/intro.mp4';
/** Only the first part of the video is shown; the sound fades out over the last half second before it ends. */
const INTRO_SECONDS = 10;
const AUDIO_FADE_SECONDS = 0.5;
/** If the video cannot play at all, fall back to the quick logo splash after this long. */
const FALLBACK_AFTER_MS = 2500;

/** Splash size: a standard software loading screen is a centered 16:9 box, not the whole display. */
const SPLASH_WIDTH = 'min(960px, 72vw)';

/**
 * Startup intro: the video plays as a standard-size, centered loading screen while the workspace loads behind it, then fades
 * away to the app. The window itself is left exactly as it is.
 * Click, Space, Enter, Escape or the Skip button end it early. If the video cannot be played the old logo splash shows.
 */
export function SplashScreen({ onDone }: { onDone: () => void }) {
  const [fading, setFading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [muted, setMuted] = useState(false);
  const [showSkip, setShowSkip] = useState(false);
  const [never, setNever] = useState(false);          // "don't play the intro again"
  const neverRef = useRef(false);
  neverRef.current = never;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const finished = useRef(false);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    if (neverRef.current) setIntroEnabled(false);
    setFading(true);
    window.setTimeout(onDone, 450);
  }, [onDone]);

  // the Skip button shows shortly after the video starts
  useEffect(() => {
    const skipTimer = window.setTimeout(() => setShowSkip(true), 800);
    return () => window.clearTimeout(skipTimer);
  }, []);

  // keys: any of these skips
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') { e.preventDefault(); finish(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finish]);

  // start with sound; if the webview refuses autoplay with audio, play muted instead
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.play().catch(() => {
      v.muted = true;
      setMuted(true);
      v.play().catch(() => setFailed(true));
    });
  }, []);

  // no video at all: the plain splash for a moment, then on to the app
  useEffect(() => {
    if (!failed) return;
    const t = window.setTimeout(finish, FALLBACK_AFTER_MS - 700);
    return () => window.clearTimeout(t);
  }, [failed, finish]);
  useEffect(() => {
    const t = window.setTimeout(() => {
      const v = videoRef.current;
      if (v && v.readyState === 0) setFailed(true);       // never even started loading
    }, FALLBACK_AFTER_MS);
    return () => window.clearTimeout(t);
  }, []);

  const unmute = () => {
    const v = videoRef.current;
    if (v && muted) { v.muted = false; setMuted(false); }
    else finish();
  };

  return (
    <div
      onClick={unmute}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: 'radial-gradient(circle at 50% 50%, #0b0f16 0%, #020305 80%)',
        opacity: fading ? 0 : 1,
        transition: 'opacity 450ms ease',
        pointerEvents: fading ? 'none' : 'auto',
        cursor: 'pointer',
      }}
    >
      {!failed ? (
        <video
          ref={videoRef}
          src={INTRO_SRC}
          autoPlay
          playsInline
          preload="auto"
          onEnded={finish}
          onTimeUpdate={(e) => {
            const v = e.currentTarget;
            if (v.currentTime >= INTRO_SECONDS) finish();
            else if (v.currentTime > INTRO_SECONDS - AUDIO_FADE_SECONDS) v.volume = Math.max(0, (INTRO_SECONDS - v.currentTime) / AUDIO_FADE_SECONDS);
          }}
          onError={() => setFailed(true)}
          style={{
            position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
            width: SPLASH_WIDTH, aspectRatio: '16 / 9', objectFit: 'cover', background: '#000',
            borderRadius: 14, boxShadow: '0 0 0 1px rgba(255,255,255,0.07), 0 24px 80px rgba(0,0,0,0.7)',
          }}
        />
      ) : (
        <div
          style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gap: 20, background: 'radial-gradient(circle at 50% 45%, #10161f 0%, #05070a 75%)',
          }}
        >
          <img src="/logo-mark.png" alt="HDRI Forge Studio" width={128} height={128} style={{ borderRadius: 22 }} />
          <div style={{ fontFamily: 'var(--font-display, sans-serif)', fontSize: 22, fontWeight: 700, color: '#e8ecf2' }}>
            HDRI Forge Studio
          </div>
        </div>
      )}

      {showSkip && !failed && (
        <label
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', right: 28, bottom: 76, display: 'flex', alignItems: 'center', gap: 8,
            padding: '7px 12px', borderRadius: 999, background: 'rgba(0,0,0,0.55)', color: '#e5e7eb',
            font: '500 12px/1 system-ui, sans-serif', cursor: 'pointer', backdropFilter: 'blur(6px)',
            animation: 'hfsIntroFade 400ms ease both',
          }}
        >
          <input type="checkbox" checked={never} onChange={(e) => setNever(e.target.checked)} />
          Don&apos;t play the intro next time
        </label>
      )}
      {showSkip && !failed && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); finish(); }}
          aria-label="Skip the intro"
          style={{
            position: 'absolute', right: 28, bottom: 28, padding: '9px 18px', borderRadius: 999,
            border: '1px solid rgba(255,255,255,0.28)', background: 'rgba(0,0,0,0.55)', color: '#fff',
            font: '500 13px/1 system-ui, sans-serif', cursor: 'pointer', backdropFilter: 'blur(6px)',
            animation: 'hfsIntroFade 400ms ease both',
          }}
        >
          Skip
        </button>
      )}
      {muted && !failed && (
        <div
          style={{
            position: 'absolute', left: 28, bottom: 28, padding: '8px 14px', borderRadius: 999,
            background: 'rgba(0,0,0,0.55)', color: '#e5e7eb', font: '500 12px/1 system-ui, sans-serif',
          }}
        >
          Click for sound
        </div>
      )}
      <style>{`@keyframes hfsIntroFade { from { opacity: 0; } to { opacity: 1; } }`}</style>
    </div>
  );
}
