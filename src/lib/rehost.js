import { createHash } from 'node:crypto';
import { EmbedBuilder } from 'discord.js';
import { isMediaUrl, readMedia, persistUrl } from './media.js';

// Images des embeds du bot (panneau de tickets, /embed, /modifierembed, bienvenue, ouverture de ticket…).
// - Un lien cdn.discordapp.com/attachments/… expire au bout d'environ 24 h et ne marche plus si le message
//   d'origine est supprimé : l'image est téléchargée et jointe au message lui-même (attachment://).
// - Une image gardée par le bot (kayo-media://, lib/media.js) est jointe au message à chaque envoi.
// À chaque modification d'un message, la pièce jointe déjà en place est reprise si c'est la même image.
const DISCORD_FILE = /^https:\/\/(?:cdn|media)\.discord(?:app)?\.(?:com|net)\/(?:attachments|ephemeral-attachments)\//i;
const HOSTED = /^(?:image|miniature)-[0-9a-f]{8}\.\w+$/;
const MAX_BYTES = 25 * 1024 * 1024;
const EXT = { 'image/gif': 'gif', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const FIELDS = ['image', 'thumbnail'];

export const isDiscordFile = (url) => DISCORD_FILE.test(url ?? '');
const prefix = (field) => (field === 'image' ? 'image' : 'miniature');
const shortHash = (text) => createHash('sha1').update(text).digest('hex').slice(0, 8);

// Nom de la pièce jointe pour un lien Discord : le même tant que le fichier d'origine est le même.
function hostedName(field, url) {
  const { pathname } = new URL(url);
  const last = decodeURIComponent(pathname.split('/').pop());
  if (HOSTED.test(last)) return last; // déjà une image jointe par le bot
  const ext = last.match(/\.(gif|png|jpe?g|webp)$/i)?.[1].toLowerCase().replace('jpeg', 'jpg') ?? null;
  return { base: `${prefix(field)}-${shortHash(pathname)}`, ext };
}

async function download(url) {
  const res = await fetch(url).catch(() => null);
  if (!res?.ok) return null;
  const type = res.headers.get('content-type')?.split(';')[0] ?? '';
  if (!type.startsWith('image/')) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  return buffer.length && buffer.length <= MAX_BYTES ? { buffer, type } : null;
}

// Renvoie le payload (envoi ou modification) avec les images jointes au message.
// existing = le message modifié (ses autres pièces jointes sont gardées), ou null pour un envoi.
export async function withHostedImages(payload, existing = null) {
  const files = [];
  const embeds = [];
  const attached = existing ? [...existing.attachments.values()] : [];
  const addFile = (attachment, name) => {
    if (!files.some((f) => f.name === name)) files.push({ attachment, name });
  };
  for (const raw of payload.embeds ?? []) {
    const data = raw?.toJSON ? raw.toJSON() : { ...raw };
    for (const field of FIELDS) {
      const url = data[field]?.url;
      if (isMediaUrl(url)) {
        // Image gardée par le bot : jointe telle quelle.
        const media = await readMedia(url);
        if (!media) {
          delete data[field]; // image perdue : pas de lien invalide dans l'embed
          continue;
        }
        const name = `${prefix(field)}-${shortHash(url)}.${media.ext}`;
        addFile(media.buffer, name);
        data[field] = { url: `attachment://${name}` };
        continue;
      }
      if (!isDiscordFile(url)) continue;
      const named = hostedName(field, url);
      const already = typeof named === 'string' ? named : attached.find((a) => a.name.startsWith(`${named.base}.`))?.name;
      // La pièce jointe déjà sur le message (lien à jour), sinon le lien d'origine.
      const source = (already && attached.find((a) => a.name === already)?.url) || url;
      const file = await download(source);
      if (!file) continue; // lien mort : laissé tel quel
      const name = already ?? `${named.base}.${named.ext ?? EXT[file.type] ?? 'png'}`;
      addFile(file.buffer, name);
      data[field] = { url: `attachment://${name}` };
    }
    embeds.push(new EmbedBuilder(data));
  }
  // Les anciennes images jointes par le bot sont remplacées ; les autres pièces jointes du message restent.
  const kept = attached.filter((a) => !HOSTED.test(a.name));
  return { ...payload, embeds, files: [...(payload.files ?? []), ...files], ...(existing ? { attachments: kept } : {}) };
}

// Avant d'enregistrer un embed qui sera renvoyé plus tard (bienvenue, partenariat, panneau, ouverture de ticket) :
// ses images Discord (qui expirent) deviennent des images gardées par le bot.
export async function persistImages(guildId, embed) {
  const out = { ...embed };
  for (const field of FIELDS) {
    const url = out[field]?.url;
    if (url && isDiscordFile(url)) out[field] = { ...out[field], url: await persistUrl(guildId, url, isDiscordFile) };
  }
  return out;
}

// Payload d'un aperçu éphémère : avec images jointes seulement s'il contient une image gardée par le bot.
export async function previewPayload(payload) {
  const needs = (payload.embeds ?? []).some((e) => {
    const d = e?.toJSON ? e.toJSON() : e;
    return FIELDS.some((f) => isMediaUrl(d?.[f]?.url));
  });
  return needs ? { ...(await withHostedImages(payload)), attachments: [] } : payload;
}
