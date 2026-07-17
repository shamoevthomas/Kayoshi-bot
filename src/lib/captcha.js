import { createCanvas } from '@napi-rs/canvas';

// Caractères sans ambiguïté (pas de O/0, I/l/1…)
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomText(length = 6) {
  let out = '';
  for (let i = 0; i < length; i++) out += CHARS[randInt(0, CHARS.length - 1)];
  return out;
}

// Génère un captcha : renvoie { text, buffer(PNG) }.
export function generateCaptcha(length = 6) {
  const text = randomText(length);
  const width = 240;
  const height = 80;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Fond
  ctx.fillStyle = '#e8e8ea';
  ctx.fillRect(0, 0, width, height);

  // Lignes de bruit
  for (let i = 0; i < 8; i++) {
    ctx.strokeStyle = `rgba(${randInt(0, 120)},${randInt(0, 120)},${randInt(0, 120)},0.6)`;
    ctx.lineWidth = randInt(1, 2);
    ctx.beginPath();
    ctx.moveTo(randInt(0, width), randInt(0, height));
    ctx.lineTo(randInt(0, width), randInt(0, height));
    ctx.stroke();
  }

  // Points de bruit
  for (let i = 0; i < 250; i++) {
    ctx.fillStyle = `rgba(${randInt(0, 150)},${randInt(0, 150)},${randInt(0, 150)},0.5)`;
    ctx.fillRect(randInt(0, width), randInt(0, height), 2, 2);
  }

  // Caractères, chacun décalé/incliné/coloré différemment
  const step = (width - 30) / text.length;
  for (let i = 0; i < text.length; i++) {
    const x = 20 + i * step;
    const y = randInt(48, 60);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((randInt(-28, 28) * Math.PI) / 180);
    ctx.font = `bold ${randInt(34, 46)}px sans-serif`;
    ctx.fillStyle = `rgb(${randInt(0, 90)},${randInt(0, 90)},${randInt(0, 90)})`;
    ctx.fillText(text[i], 0, 0);
    ctx.restore();
  }

  return { text, buffer: canvas.toBuffer('image/png') };
}
