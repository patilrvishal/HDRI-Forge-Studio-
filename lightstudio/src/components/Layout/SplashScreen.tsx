import { useEffect, useState } from 'react';

/** Full-screen loading splash shown briefly on startup, with a shimmer
 *  sweep across the logo. Fades out once the minimum display time elapses. */
export function SplashScreen({ onDone }: { onDone: () => void }) {
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFading(true), 1400);
    const doneTimer = setTimeout(onDone, 1800);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(doneTimer);
    };
  }, [onDone]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
        background: 'radial-gradient(circle at 50% 45%, #10161f 0%, #05070a 75%)',
        opacity: fading ? 0 : 1,
        transition: 'opacity 400ms ease',
        pointerEvents: fading ? 'none' : 'auto',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: 128,
          height: 128,
          borderRadius: 22,
          overflow: 'hidden',
          boxShadow: '0 0 60px rgba(90,170,255,0.25), 0 0 120px rgba(255,170,80,0.12)',
        }}
      >
        <img
          src="/logo-mark.png"
          alt="HDRI Forge Studio"
          width={128}
          height={128}
          style={{ display: 'block', width: 128, height: 128, objectFit: 'cover' }}
        />
        {/* shimmer sweep */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(115deg, transparent 35%, rgba(255,255,255,0.65) 50%, transparent 65%)',
            backgroundSize: '300% 300%',
            backgroundPosition: '-100% 0',
            animation: 'hfsSplashShimmer 1.6s ease-in-out infinite',
            mixBlendMode: 'overlay',
          }}
        />
      </div>

      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            fontFamily: 'var(--font-display, sans-serif)',
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: '-0.01em',
            color: '#e8ecf2',
          }}
        >
          HDRI{' '}
          <span
            style={{
              background: 'linear-gradient(90deg, #5ab0ff, #ffb15a)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            Forge
          </span>{' '}
          Studio
        </div>
        <div style={{ fontSize: 11, color: '#7c8798', marginTop: 6, letterSpacing: '0.08em' }}>
          LOADING WORKSPACE
        </div>
      </div>

      <style>{`
        @keyframes hfsSplashShimmer {
          0% { background-position: -120% 0; }
          55% { background-position: 120% 0; }
          100% { background-position: 120% 0; }
        }
      `}</style>
    </div>
  );
}
