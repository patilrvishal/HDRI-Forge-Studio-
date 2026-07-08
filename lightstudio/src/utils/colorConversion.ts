export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const cleaned = hex.replace('#', '');
  const num = parseInt(cleaned, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (c: number): string => {
    const clamped = Math.min(255, Math.max(0, Math.round(c)));
    const hex = clamped.toString(16);
    return hex.length === 1 ? `0${hex}` : hex;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Convert color temperature in Kelvin (1000–40000) to hex color.
 * Based on Tanner Helland's algorithm (approximation of Planckian locus).
 */
export function kelvinToHex(kelvin: number): string {
  const temp = Math.max(1000, Math.min(40000, kelvin)) / 100;

  let r: number;
  let g: number;
  let b: number;

  if (temp <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(temp) - 161.1195681661;
    b = temp <= 19 ? 0 : 138.5177312231 * Math.log(temp - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(temp - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(temp - 60, -0.0755148492);
    b = 255;
  }

  return rgbToHex(r, g, b);
}

/**
 * Approximate inverse of kelvinToHex: convert hex to nearest Kelvin temperature.
 * Searches in the 1000–40000K range using binary search to minimize color distance.
 */
export function hexToKelvin(hex: string): number {
  const { r: tr, g: tg, b: tb } = hexToRgb(hex);

  const colorDist = (r: number, g: number, b: number): number => {
    return (tr - r) ** 2 + (tg - g) ** 2 + (tb - b) ** 2;
  };

  let low = 1000;
  let high = 40000;
  let bestK = 6500;
  let bestDist = Infinity;

  // Coarse search
  for (let k = low; k <= high; k += 200) {
    const { r, g, b } = hexToRgb(kelvinToHex(k));
    const d = colorDist(r, g, b);
    if (d < bestDist) {
      bestDist = d;
      bestK = k;
    }
  }

  // Fine search around best coarse match
  const fineLow = Math.max(low, bestK - 300);
  const fineHigh = Math.min(high, bestK + 300);
  for (let k = fineLow; k <= fineHigh; k += 10) {
    const { r, g, b } = hexToRgb(kelvinToHex(k));
    const d = colorDist(r, g, b);
    if (d < bestDist) {
      bestDist = d;
      bestK = k;
    }
  }

  return bestK;
}

export function colorProfileToHex(profile: string): string {
  switch (profile) {
    case 'daylight':
      return '#fff5e6';
    case 'tungsten':
      return '#ffcc80';
    case 'fluorescent':
      return '#e0f0ff';
    case 'custom':
    default:
      return '#ffffff';
  }
}