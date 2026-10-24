import { GlobalFonts, loadImage } from '@napi-rs/canvas';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Polices des images générées (stats, love calc), fournies avec le bot (assets/fonts) :
// l'hébergeur n'en a pas forcément.
const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'fonts');
for (const [file, family] of [
  ['NotoSans-Regular.ttf', 'Kayoshi Sans'],
  ['NotoSans-Bold.ttf', 'Kayoshi Sans'],
  ['NotoSans-Italic.ttf', 'Kayoshi Sans'],
  ['NotoSerif-Bold.ttf', 'Kayoshi Serif'],
  ['NotoSansSymbols2-Regular.ttf', 'Kayoshi Symbols'],
  ['NotoSansJP-Brackets.ttf', 'Kayoshi CJK'],
  ['Twemoji.Mozilla.ttf', 'Kayoshi Emoji'],
]) {
  GlobalFonts.registerFromPath(join(FONT_DIR, file), family);
}

// Texte : lettres, puis symboles (✧), crochets 『』, et emojis en couleur.
const FAMILIES = '"Kayoshi Sans", "Kayoshi Symbols", "Kayoshi CJK", "Kayoshi Emoji"';
// serif : Noto Serif (gras seulement), les autres polices prenant le relais pour les caractères qu'elle n'a pas.
export const font = (size, { bold = false, italic = false, serif = false } = {}) =>
  `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px ${serif ? '"Kayoshi Serif", ' : ''}${FAMILIES}`;
// Pictogrammes monochromes (🏆 🔊 📈 🗘) : symboles seulement, pas les emojis en couleur.
export const iconFont = (size) => `${size}px "Kayoshi Symbols"`;

// Image distante (avatar, icône de serveur), ou null si indisponible.
export async function fetchImage(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return await loadImage(Buffer.from(await res.arrayBuffer()));
  } catch {
    return null;
  }
}
