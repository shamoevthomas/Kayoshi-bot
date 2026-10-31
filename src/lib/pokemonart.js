import { createCanvas } from '@napi-rs/canvas';
import { fetchImage } from './fonts.js';
import { POKEMON } from './pokemondata.js';

// Commun aux jeux Pokémon (+pokemon dans lib/chatgames.js, salon /pokemon dans lib/pokemongame.js) :
// images (silhouette puis Pokémon dévoilé, normal ou brillant) et reconnaissance du nom écrit.
const ARTWORK = (id, shiny) =>
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${shiny ? 'shiny/' : ''}${id}.png`;
const normalize = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const pokeKey = (name) => normalize(name).replace(/[^a-z0-9]/g, '');
const ALL_KEYS = new Set(POKEMON.flatMap((p) => [pokeKey(p[1]), pokeKey(p[2])]));

// Silhouette noire et Pokémon dévoilé (brillant si shiny), sur le même fond.
export async function pokemonImages(id, { shiny = false } = {}) {
  const art = await fetchImage(ARTWORK(id, false));
  const shown = shiny ? (await fetchImage(ARTWORK(id, true))) ?? art : art;
  if (!art) return null;
  const SIZE = 512;
  const draw = async (image, silhouette) => {
    const canvas = createCanvas(SIZE, SIZE);
    const ctx = canvas.getContext('2d');
    const bg = ctx.createRadialGradient(SIZE / 2, SIZE / 2, 30, SIZE / 2, SIZE / 2, SIZE * 0.72);
    bg.addColorStop(0, '#fff8dc');
    bg.addColorStop(1, '#f5b942');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, SIZE, SIZE);
    const shape = createCanvas(SIZE, SIZE);
    const sctx = shape.getContext('2d');
    const scale = Math.min((SIZE - 60) / image.width, (SIZE - 60) / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    sctx.drawImage(image, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
    if (silhouette) {
      sctx.globalCompositeOperation = 'source-in';
      sctx.fillStyle = '#16161d';
      sctx.fillRect(0, 0, SIZE, SIZE);
    }
    ctx.drawImage(shape, 0, 0);
    return canvas.encode('png');
  };
  return { silhouette: await draw(art, true), reveal: await draw(shown, false) };
}

// Distance d'édition entre deux mots.
function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

// Le texte désigne-t-il ce Pokémon ? Nom français ou anglais, dans une phrase, ou avec une faute de frappe
// (noms de 6 lettres ou plus) — mais pas le nom exact d'un autre Pokémon (Nidorino ≠ Nidorina).
export function matchesPokemon(text, pokemon) {
  const full = pokeKey(text);
  const words = normalize(text).split(/[^a-z0-9]+/).filter(Boolean);
  const keys = [...new Set([pokeKey(pokemon[1]), pokeKey(pokemon[2])])];
  const typo = (k) => k.length >= 6 && !ALL_KEYS.has(full) && Math.abs(full.length - k.length) <= 1 && editDistance(full, k) <= 1;
  return keys.some((k) => full === k || words.includes(k) || typo(k));
}
