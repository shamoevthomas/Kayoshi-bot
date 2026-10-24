import gifenc from 'gifenc';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const { GIFEncoder, quantize, applyPalette } = gifenc;

// Conversion d'une image fixe (png, jpg, webp…) en GIF d'une seule image, pour /gif.
// Réduite à 1280 px de côté au plus ; la transparence est gardée.
const MAX_SIDE = 1280;

export async function imageToGif(buffer) {
  const img = await loadImage(buffer);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);

  // Palette de 256 couleurs : avec un canal alpha seulement si l'image a de la transparence
  // (sinon on garde plus de précision sur les couleurs).
  let transparent = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 128) {
      transparent = true;
      break;
    }
  }
  const format = transparent ? 'rgba4444' : 'rgb565';
  const palette = quantize(data, 256, { format, oneBitAlpha: transparent });
  const index = applyPalette(data, palette, format);
  const transparentIndex = transparent ? palette.findIndex((color) => color[3] === 0) : -1;

  const gif = GIFEncoder();
  gif.writeFrame(index, width, height, { palette, transparent: transparentIndex >= 0, transparentIndex: Math.max(0, transparentIndex) });
  gif.finish();
  return Buffer.from(gif.bytes());
}
