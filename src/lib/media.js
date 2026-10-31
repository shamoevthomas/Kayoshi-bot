import { createHash } from 'node:crypto';
import { loadMedia, saveMedia } from './store.js';

// Images envoyées au bot en fichier (formulaire d'embed, /bienvenue, /modifierembedticket…) et images Discord
// (cdn.discordapp.com/attachments/…) d'un embed enregistré : les liens Discord expirent, alors l'image est gardée
// dans la base (ligne media:<serveur>:<empreinte>). L'embed enregistré la désigne par « kayo-media://<serveur>/<empreinte>.<ext> »,
// et elle est jointe au message à chaque envoi (lib/rehost.js).
export const MEDIA_SCHEME = 'kayo-media://';
export const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const EXT = { 'image/gif': 'gif', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const cache = new Map(); // url → { buffer, ext, type }, les plus récentes en dernier
const CACHE_MAX = 30;

export const isMediaUrl = (url) => typeof url === 'string' && url.startsWith(MEDIA_SCHEME);

function remember(url, media) {
  cache.delete(url);
  cache.set(url, media);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

// Garde une image (octets) pour ce serveur. Renvoie son lien kayo-media://.
export async function storeImage(guildId, buffer, type) {
  const ext = EXT[type] ?? 'png';
  const hash = createHash('sha1').update(buffer).digest('hex').slice(0, 16);
  const url = `${MEDIA_SCHEME}${guildId}/${hash}.${ext}`;
  if (!cache.has(url)) await saveMedia(`${guildId}:${hash}`, { type, ext, data: buffer.toString('base64'), at: Date.now() });
  remember(url, { buffer, ext, type });
  return url;
}

async function download(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!res?.ok) return null;
  const type = res.headers.get('content-type')?.split(';')[0] ?? '';
  if (!type.startsWith('image/')) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  return buffer.length && buffer.length <= MAX_MEDIA_BYTES ? { buffer, type } : null;
}

// Fichier envoyé dans un formulaire ou une option de commande. Renvoie { url } ou { error }.
export async function storeUpload(guildId, attachment) {
  if (!attachment.contentType?.startsWith('image/')) return { error: 'Le fichier doit être une image (PNG, JPG, GIF ou WEBP).' };
  if (attachment.size > MAX_MEDIA_BYTES) return { error: `Image trop lourde : ${MAX_MEDIA_BYTES / 1024 / 1024} Mo maximum.` };
  const file = await download(attachment.url);
  if (!file) return { error: 'Je n’ai pas pu récupérer le fichier, réessaie.' };
  return { url: await storeImage(guildId, file.buffer, file.type) };
}

// Lien Discord (qui expire) → image gardée ; un autre lien est rendu tel quel, comme un lien mort.
export async function persistUrl(guildId, url, isDiscordFile) {
  if (!isDiscordFile(url)) return url;
  const file = await download(url);
  return file ? storeImage(guildId, file.buffer, file.type) : url;
}

// Octets d'une image gardée, ou null si elle n'existe plus.
export async function readMedia(url) {
  if (!isMediaUrl(url)) return null;
  if (cache.has(url)) {
    const media = cache.get(url);
    remember(url, media);
    return media;
  }
  const match = url.slice(MEDIA_SCHEME.length).match(/^(\d+|[\w-]+)\/([0-9a-f]+)\.(\w+)$/);
  if (!match) return null;
  const row = await loadMedia(`${match[1]}:${match[2]}`).catch(() => null);
  if (!row?.data) return null;
  const media = { buffer: Buffer.from(row.data, 'base64'), ext: row.ext, type: row.type };
  remember(url, media);
  return media;
}
