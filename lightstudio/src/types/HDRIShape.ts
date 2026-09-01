/**
 * Basic light-emitting (or light-blocking) shapes painted directly onto the
 * HDRI equirectangular map - the same idea as HDR Light Studio's composite
 * lights. Once added, a shape behaves exactly like part of the HDRI: it
 * lights reflections in the live viewport, shows up in the HDRI Preview,
 * and gets baked into exported .hdr/.exr files.
 *
 * Stacking order is simply the shape's index in the store's array - later
 * entries paint on top of earlier ones, so a black shape drawn after a
 * bright one visually blocks it, matching real HDRI blocker behaviour.
 */
export type HDRIShapeType = 'rectangle' | 'circle' | 'gradient-strip';

export interface HDRIShape {
  id: string;
  name: string;
  type: HDRIShapeType;
  visible: boolean;
  /** Hex color. Pure black (#000000) at full opacity acts as a blocker -
   *  it paints solid black, contributing zero light and occluding whatever
   *  was drawn under it in the stack. */
  color: string;
  /** 0-100. How strongly this shape's paint replaces what's beneath it. */
  opacity: number;
  /** 0-1, normalized horizontal position on the equirect map (longitude). */
  u: number;
  /** 0-1, normalized vertical position on the equirect map (latitude). */
  v: number;
  /** 0-1, normalized width (fraction of map width). */
  width: number;
  /** 0-1, normalized height (fraction of map height). Circle uses this as
   *  its radius basis (average of width/height). */
  height: number;
  /** Degrees. Applies to rectangle and gradient-strip only. */
  rotation: number;
  /** 0-100. Edge feather - 0 is a hard cutout, 100 is fully soft. */
  softness: number;
}

export function createDefaultHDRIShape(type: HDRIShapeType, index: number): HDRIShape {
  const id = `hdrishape_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const labels: Record<HDRIShapeType, string> = {
    rectangle: 'Rectangle',
    circle: 'Circle',
    'gradient-strip': 'Gradient Strip',
  };
  const base: HDRIShape = {
    id,
    name: `${labels[type]} ${index + 1}`,
    type,
    visible: true,
    color: '#ffffff',
    opacity: 100,
    u: 0.5,
    v: 0.35,
    width: type === 'gradient-strip' ? 0.6 : 0.18,
    height: type === 'gradient-strip' ? 0.06 : 0.18,
    rotation: 0,
    softness: 35,
  };
  return base;
}
