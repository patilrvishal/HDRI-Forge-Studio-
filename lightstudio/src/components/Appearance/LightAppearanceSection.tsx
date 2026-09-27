import React, { useEffect, useRef, useState } from 'react';
import type { Light } from '../../types/Light';
import { createDefaultTexturedArea } from '../../types/Light';
import type { LightAppearance } from '../../appearance/types';
import { newAppearance } from '../../appearance/content';
import { APPEARANCE_PRESETS } from '../../appearance/presets';
import { useAppearanceStore } from '../../appearance/appearanceStore';
import { renderTexture } from '../../appearance/textures';
import { drawTextureToCanvas } from '../../appearance/preview';
import { exportLightTexture, exportAreaLightPack, lightAspect } from '../../appearance/exportTextures';
import { useLightsStore } from '../../store/lightsStore';
import { AppearanceEditor } from './AppearanceEditor';
import { PresetLibrary } from './PresetLibrary';
import { Slider } from '../UI/Slider';
import { NumericInput } from '../UI/NumericInput';
import * as THREE from 'three';
import { Toggle } from '../UI/Toggle';

const Section: React.FC<{ title: string; children: React.ReactNode; defaultOpen?: boolean; right?: React.ReactNode }> = ({ title, children, defaultOpen = true, right }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="props-section">
      <div className="section-header" onClick={() => setOpen((o) => !o)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, userSelect: 'none' }}>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" style={{ flexShrink: 0, opacity: 0.65, transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease' }}>
          <path d="M2 0l4 4-4 4z" />
        </svg>
        <span style={{ flex: 1 }}>{title}</span>
        {right && <span onClick={(e) => e.stopPropagation()}>{right}</span>}
      </div>
      {open && children}
    </div>
  );
};

const Hint: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontSize: 9, color: 'var(--text-dim)', lineHeight: 1.45, margin: '2px 0 6px' }}>{children}</div>
);

/** Radius of the model(s) around the origin. */
function sceneRadiusOf(scene: import('three').Scene): number {
  const box = new THREE.Box3();
  const b = new THREE.Box3();
  scene.traverse((o) => {
    const m = o as import('three').Mesh;
    if (!m.isMesh || o.name === '__floor__' || o.name === 'TransformControlsPlane' || !o.visible || !m.geometry) return;
    for (let p: import('three').Object3D | null = o; p; p = p.parent) if (p.userData?.isHelper || p.userData?.isProxy || p.userData?.isGrid) return;
    b.setFromObject(m);
    if (!b.isEmpty()) box.union(b);
  });
  if (box.isEmpty()) return 2;
  return Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 0.5);
}

/** LightPaint Pos: the XYZ point this light was last painted onto (its aim point). */
const LightPaintPos: React.FC<{ light: Light }> = ({ light }) => {
  const update = useLightsStore((s) => s.updateLightTransform);
  const aim = (light.transform as { aimTarget?: { x: number; y: number; z: number } }).aimTarget;
  if (!aim) return <Hint>LightPaint Pos: not painted yet. Use LightPaint on the model to aim this light.</Hint>;
  const set = (axis: 'x' | 'y' | 'z', v: number) => update(light.id, { aimTarget: { ...aim, [axis]: v } } as never);
  return (
    <div>
      <div className="field-label" style={{ fontSize: 10, margin: '4px 0 2px' }}>LightPaint Pos</div>
      <div style={{ display: 'flex', gap: 4 }}>
        {(['x', 'y', 'z'] as const).map((k) => (
          <div key={k} style={{ flex: 1 }}>
            <NumericInput label={k.toUpperCase()} value={+aim[k].toFixed(3)} step={0.05} onChange={(v) => set(k, v)} width="100%" />
          </div>
        ))}
      </div>
    </div>
  );
};

/** Canvas showing the rendered appearance over a checkerboard. */
export const AppearanceCanvas: React.FC<{ appearance: LightAppearance; aspect: number; longSide?: number; maxHeight?: number }> = ({ appearance, aspect, longSide = 200, maxHeight = 220 }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const raf = useRef(0);
  const imagesVersion = useAppearanceStore((s) => s.imagesVersion);
  useEffect(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      if (!ref.current) return;
      try {
        drawTextureToCanvas(ref.current, renderTexture(appearance, aspect, longSide));
      } catch (e) {
        console.warn('[appearance] preview failed', e);
      }
    });
    return () => cancelAnimationFrame(raf.current);
  }, [appearance, aspect, longSide, imagesVersion]);
  return <canvas ref={ref} style={{ width: '100%', maxHeight, objectFit: 'contain', borderRadius: 4, border: '1px solid var(--border, #333)', background: '#111', imageRendering: 'auto' }} />;
};

interface Props {
  light: Light;
  onUpdate: (u: Partial<Light>) => void;
}

/**
 * Light Appearance + HDR Textured Area Light controls for an area-type light.
 */
export const LightAppearanceSection: React.FC<Props> = ({ light, onUpdate }) => {
  const [showLib, setShowLib] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [hover, setHover] = useState<LightAppearance | null>(null);
  const setAudition = useAppearanceStore((s) => s.setAudition);
  const lights = useLightsStore((s) => s.lights);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const aspect = lightAspect(light);
  const tex = light.areaTex ?? createDefaultTexturedArea();
  const setTex = (patch: Partial<typeof tex>) => onUpdate({ areaTex: { ...tex, ...patch } });

  // Leaving the panel / selecting another light must not leave a stale audition behind.
  useEffect(() => () => setAudition(null), [light.id, setAudition]);

  const audition = (a: LightAppearance | null) => {
    setHover(a);
    setAudition(a ? { lightId: light.id, appearance: a } : null);
  };

  const shown = hover ?? light.appearance ?? null;

  const scene = (window as unknown as { __lightforgeScene?: { scene: import('three').Scene } }).__lightforgeScene?.scene;

  const run = async (label: string, fn: () => Promise<string | void>) => {
    setBusy(label);
    setMsg('');
    try {
      const r = await fn();
      if (r) setMsg(r);
    } catch (e) {
      setMsg('Failed: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <Section title="Light Appearance">
        {shown ? (
          <>
            <AppearanceCanvas appearance={shown} aspect={aspect} />
            <div style={{ fontSize: 10, color: 'var(--text-sec)', margin: '4px 0' }}>
              {hover ? `Previewing: ${hover.name}` : light.appearance!.name}
            </div>
          </>
        ) : (
          <Hint>Classic light: flat colour shaped only by Edge Softness. Enable Light Appearance to design its look with content, gradients, images and blends.</Hint>
        )}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
          {!light.appearance ? (
            <button
              className="btn-sm"
              onClick={() => {
                const base = APPEARANCE_PRESETS.find((p) => p.name === 'Softbox Square')!.build();
                onUpdate({ appearance: base });
              }}
            >
              Enable Light Appearance
            </button>
          ) : (
            <>
              <button className="btn-sm" onClick={() => { setShowLib((s) => !s); }}>{showLib ? 'Hide presets' : 'Preset library'}</button>
              <button className="btn-sm" onClick={() => setShowEditor((s) => !s)}>{showEditor ? 'Hide editor' : 'Edit appearance'}</button>
              <button className="btn-sm" title="Go back to the classic flat light" onClick={() => { audition(null); onUpdate({ appearance: undefined }); }}>Reset</button>
            </>
          )}
        </div>
        {light.appearance && showLib && (
          <PresetLibrary
            compact
            current={light.appearance}
            currentAspect={aspect}
            onAudition={audition}
            onApply={(a, asp) => {
              audition(null);
              // Presets carry their natural shape: strips are long and thin, so match the light's proportions.
              const patch: Partial<Light> = { appearance: a };
              if (asp !== 1 && !light.objectKey) {
                const area = (light.areaWidth ?? 2) * (light.areaHeight ?? 2);
                const w = Math.sqrt(area * asp);
                patch.areaWidth = Math.min(20, Math.max(0.1, +w.toFixed(2)));
                patch.areaHeight = Math.min(20, Math.max(0.1, +(area / w).toFixed(2)));
              }
              onUpdate(patch);
            }}
          />
        )}
        {light.appearance && showEditor && (
          <AppearanceEditor appearance={light.appearance} aspect={aspect} onChange={(a) => onUpdate({ appearance: a })} onRestoreAspect={(ia) => onUpdate({ areaHeight: Math.min(20, Math.max(0.1, +((light.areaWidth ?? 2) / Math.max(0.05, ia)).toFixed(3))) })} />
        )}
        {light.appearance && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            <button className="btn-sm" disabled={!!busy} onClick={() => run('exr', () => exportLightTexture(light, 'exr'))}>Export EXR (RGBA)</button>
            <button className="btn-sm" disabled={!!busy} onClick={() => run('png', () => exportLightTexture(light, 'png'))}>Export PNG</button>
          </div>
        )}
      </Section>

      {!light.objectKey && (
        <Section title="Area Light (HDR Textured)" defaultOpen={false} right={<Toggle checked={tex.enabled} variant="glossy" onChange={(v) => setTex({ enabled: v })} />}>
          <div style={{ opacity: tex.enabled ? 1 : 0.5 }}>
            <Hint>
              Area Light mode (Ctrl+Space) turns this light into a real 3D rectangle carrying its appearance as an RGBA texture. It lights and reflects in the viewport and path tracer,
              and is delivered as a texture instead of being painted into the exported HDRI.
            </Hint>
            <Toggle label="Cam visibility" checked={tex.camVisibility} variant="glossy" onChange={(v) => setTex({ camVisibility: v })} />
            <Slider label="Smart Dolly" value={tex.smartDolly} min={0.1} max={3} step={0.01} onChange={(v) => setTex({ smartDolly: v })} />
            <div style={{ display: 'flex', gap: 6, margin: '2px 0 6px', alignItems: 'center' }}>
              <button
                className="btn-sm"
                disabled={!scene}
                title="Set Smart Dolly so the panel sits just outside the model"
                onClick={() => {
                  if (!scene) return;
                  const r = sceneRadiusOf(scene);
                  const r0 = Math.max(0.05, Math.hypot(light.transform.position.x, light.transform.position.y, light.transform.position.z));
                  setTex({ smartDolly: Math.min(3, Math.max(0.1, +((r * 1.25) / r0).toFixed(2))) });
                }}
              >
                Fit outside model
              </button>
              <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>Moves the light and scales it so the light on the model stays consistent.</span>
            </div>
            <Slider label="Dolly multiplier" value={tex.dollyMultiplier} min={0.25} max={4} step={0.01} unit="x" onChange={(v) => setTex({ dollyMultiplier: v })} />
            <Toggle label="Maintain reflection size" checked={tex.maintainReflectionSize} variant="glossy" onChange={(v) => setTex({ maintainReflectionSize: v })} />
            <Slider label="Spread" value={tex.spread} min={0} max={100} step={1} unit="%" onChange={(v) => setTex({ spread: v })} />
            <Slider label="Texture scale" value={tex.textureScale ?? 1} min={0.25} max={4} step={0.25} unit="x" onChange={(v) => setTex({ textureScale: v })} />
            <LightPaintPos light={light} />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              <button
                className="btn-sm"
                disabled={!!busy || !scene}
                title="Zip with one RGBA texture per Area Light + placement JSON"
                onClick={() => run('pack', async () => {
                  const n = await exportAreaLightPack(scene!, lights, 'exr');
                  return n ? `Exported ${n} area light texture(s).` : 'No Area Light mode lights to export.';
                })}
              >
                Export area-light pack (EXR)
              </button>
              <button
                className="btn-sm"
                disabled={!!busy || !scene}
                onClick={() => run('packpng', async () => {
                  const n = await exportAreaLightPack(scene!, lights, 'png');
                  return n ? `Exported ${n} area light texture(s).` : 'No Area Light mode lights to export.';
                })}
              >
                PNG pack
              </button>
            </div>
          </div>
        </Section>
      )}
      {msg && <div style={{ fontSize: 10, color: 'var(--text-sec)', padding: '2px 8px' }}>{msg}</div>}
    </>
  );
};
