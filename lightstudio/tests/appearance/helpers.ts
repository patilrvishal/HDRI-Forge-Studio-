import { renderAppearance as render, averageRadiance, linearToSrgbChannel } from '../../src/appearance/evaluate';
import type { AppearanceImage, LightAppearance } from '../../src/appearance/types';

export { averageRadiance };
export const l2sExport = linearToSrgbChannel;
export function renderAppearance(app: LightAppearance, w: number, h: number, aspect: number, images: Map<string, AppearanceImage> = new Map()) {
  return render(app, w, h, aspect, { images });
}
