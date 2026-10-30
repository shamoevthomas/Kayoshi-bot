import { createHash } from 'node:crypto';
import { EmbedBuilder } from 'discord.js';

// Images Discord dans les embeds du bot (panneau de tickets, embeds de /embed et /modifierembed).
// Un lien cdn.discordapp.com/attachments/… expire au bout d'environ 24 h et ne marche plus si le message
// d'origine est supprimé : l'image est alors téléchargée et jointe au message lui-même (attachment://),
// où elle ne disparaît plus. Le lien d'origine reste enregistré : à chaque modification du message, la pièce
// jointe déjà en place est reprise (son nom dépend du lien d'origine), sinon le lien est retéléchargé.
const DISCORD_FILE = /^https:\/\/(?:cdn|media)\.discord(?:app)?\.(?:com|net)\/(?:attachments|ephemeral-attachments)\//i;
const HOSTED = /^(?:image|miniature)-[0-9a-f]{8}\.\w+$/;
const MAX_BYTES = 25 * 1024 * 1024;
const EXT = { 'image/gif': 'gif', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export const isDiscordFile = (url) => DISCORD_FILE.test(url ?? '');

// Nom de la pièce jointe pour ce lien : le même tant que le fichier d'origine est le même.
function hostedName(field, url) {
  const { pathname } = new URL(url);
  const last = decodeURIComponent(pathname.split('/').pop());
  if (HOSTED.test(last)) return last; // déjà une image jointe par le bot
  const ext = last.match(/\.(gif|png|jpe?g|webp)$/i)?.[1].toLowerCase().replace('jpeg', 'jpg') ?? null;
  const hash = createHash('sha1').update(pathname).digest('hex').slice(0, 8);
  return { base: `${field === 'image' ? 'image' : 'miniature'}-${hash}`, ext };
}

async function download(url) {
  const res = await fetch(url).catch(() => null);
  if (!res?.ok) return null;
  const type = res.headers.get('content-type')?.split(';')[0] ?? '';
  if (!type.startsWith('image/')) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  return buffer.length && buffer.length <= MAX_BYTES ? { buffer, type } : null;
}

// Renvoie le payload (envoi ou modification) avec les images Discord jointes au message.
// existing = le message modifié (ses autres pièces jointes sont gardées), ou null pour un envoi.
export async function withHostedImages(payload, existing = null) {
  const files = [];
  const embeds = [];
  const attached = existing ? [...existing.attachments.values()] : [];
  for (const [index, raw] of (payload.embeds ?? []).entries()) {
    const data = raw?.toJSON ? raw.toJSON() : { ...raw };
    if (index === 0) {
      for (const field of ['image', 'thumbnail']) {
        const url = data[field]?.url;
        if (!isDiscordFile(url)) continue;
        const named = hostedName(field, url);
        const already = typeof named === 'string' ? named : attached.find((a) => a.name.startsWith(`${named.base}.`))?.name;
        // La pièce jointe déjà sur le message (lien à jour), sinon le lien d'origine.
        const source = (already && attached.find((a) => a.name === already)?.url) || url;
        const file = await download(source);
        if (!file) continue; // lien mort : laissé tel quel
        const name = already ?? `${named.base}.${named.ext ?? EXT[file.type] ?? 'png'}`;
        files.push({ attachment: file.buffer, name });
        data[field] = { url: `attachment://${name}` };
      }
    }
    embeds.push(new EmbedBuilder(data));
  }
  // Les anciennes images jointes par le bot sont remplacées ; les autres pièces jointes du message restent.
  const kept = attached.filter((a) => !HOSTED.test(a.name));
  return { ...payload, embeds, files, ...(existing ? { attachments: kept } : {}) };
}
