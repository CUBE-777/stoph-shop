// Client-side image preparation before upload: downscale (max 1600 px) and re-encode to WebP.
// Free alternative to Supabase image transformations (paid plans only). Falls back to the original file on any problem.
import { fitWithin } from './shop.js';

export async function prepareImage(file, { max = 1600, quality = 0.82 } = {}) {
  try {
    if (!file?.type?.startsWith('image/') || typeof createImageBitmap !== 'function') return file;
    const bmp = await createImageBitmap(file);
    const { width, height } = fitWithin(bmp.width, bmp.height, max);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d').drawImage(bmp, 0, 0, width, height);
    bmp.close?.();
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/webp', quality));
    if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return file;   // keep the original when it is already smaller
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp' });
  } catch { return file; }
}
