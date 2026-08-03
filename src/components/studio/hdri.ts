/**
 * Turn an imported HDRI/image file into a preview image URL that an <img>
 * or CSS background can display. Runs fully client-side (no upload):
 *  - Standard images (jpg/png/webp/…) → object URL directly.
 *  - Radiance .hdr → decoded with three's RGBELoader and tone-mapped to a
 *    small JPEG data URL.
 * Returns null if the format can't be previewed (caller falls back to a
 * gradient placeholder card).
 */
export async function fileToPreviewUrl(file: File): Promise<string | null> {
  const name = file.name.toLowerCase()

  if (file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|avif)$/.test(name)) {
    return URL.createObjectURL(file)
  }

  if (name.endsWith('.hdr')) {
    try {
      const THREE = await import('three')
      const { RGBELoader } = await import('three/addons/loaders/RGBELoader.js')
      const loader = new RGBELoader()
      loader.setDataType(THREE.FloatType)
      const buf = await file.arrayBuffer()
      // parse returns { width, height, data } — data is Float32 RGBA/RGB
      const res = loader.parse(buf) as unknown as {
        width: number
        height: number
        data: Float32Array
      }
      const { width, height, data } = res
      const comps = data.length / (width * height)

      const TW = 320
      const TH = 160
      const canvas = document.createElement('canvas')
      canvas.width = TW
      canvas.height = TH
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      const out = ctx.createImageData(TW, TH)
      const exposure = 1.3
      for (let y = 0; y < TH; y++) {
        for (let x = 0; x < TW; x++) {
          const sx = Math.min(width - 1, Math.floor((x / TW) * width))
          const sy = Math.min(height - 1, Math.floor((y / TH) * height))
          const si = (sy * width + sx) * comps
          let r = (data[si] || 0) * exposure
          let g = (data[si + 1] || 0) * exposure
          let b = (data[si + 2] || 0) * exposure
          // Reinhard tone map + gamma 2.2
          r = r / (1 + r)
          g = g / (1 + g)
          b = b / (1 + b)
          const di = (y * TW + x) * 4
          out.data[di] = Math.pow(Math.max(0, r), 1 / 2.2) * 255
          out.data[di + 1] = Math.pow(Math.max(0, g), 1 / 2.2) * 255
          out.data[di + 2] = Math.pow(Math.max(0, b), 1 / 2.2) * 255
          out.data[di + 3] = 255
        }
      }
      ctx.putImageData(out, 0, 0)
      return canvas.toDataURL('image/jpeg', 0.85)
    } catch (e) {
      console.warn('[studio] HDR decode failed:', e)
      return null
    }
  }

  // .exr and others: not previewable here.
  return null
}
