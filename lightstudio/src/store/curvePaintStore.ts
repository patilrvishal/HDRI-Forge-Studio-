import { create } from 'zustand';

/**
 * Bridges the 2D Lumi-Curve editor (CurveEditor.tsx, a small SVG panel in the
 * Properties dock) to the 3D Viewport's LightPaint click handler. HDR Light
 * Studio lets you LightPaint an individual curve point directly onto the
 * model - clicking the model repositions just that ONE point's content-space
 * (x,y) via the same reverse-reflection math as painting a whole light,
 * instead of moving the light itself. The two components don't otherwise
 * share state, so "which point is currently armed for painting" lives here.
 */
interface CurvePaintState {
  /** Index into the active Lumi-Curve's points[] armed for LightPaint, or
   *  null when no point is armed (viewport clicks behave as normal LightPaint). */
  armedPointIndex: number | null;
  armPoint: (i: number) => void;
  disarm: () => void;
}

export const useCurvePaintStore = create<CurvePaintState>((set) => ({
  armedPointIndex: null,
  armPoint: (i) => set({ armedPointIndex: i }),
  disarm: () => set({ armedPointIndex: null }),
}));

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __curvePaintStore?: unknown }).__curvePaintStore = useCurvePaintStore;
}
