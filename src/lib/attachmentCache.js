// Cache mémoire des pièces jointes (images/vidéos) pour pouvoir les ré-afficher
// dans les logs quand un message est supprimé. Discord efface le fichier de son
// CDN dès la suppression : il faut donc l'avoir téléchargé AVANT.
//
// Bornes (adaptées au plan gratuit Render ~512 Mo) :
//  - on ne garde que les images et vidéos ;
//  - chaque fichier doit faire ≤ MAX_FILE_BYTES ;
//  - le cache total est plafonné à MAX_TOTAL_BYTES (éviction du plus ancien) ;
//  - chaque entrée expire après TTL_MS.

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 Mo par fichier
const MAX_TOTAL_BYTES = 60 * 1024 * 1024; // 60 Mo au total
const TTL_MS = 15 * 60 * 1000; // 15 minutes

const cache = new Map(); // messageId -> { files: [{ name, buffer }], size, expires }
let totalBytes = 0;

function isMedia(attachment) {
  const type = attachment.contentType ?? '';
  if (type.startsWith('image/') || type.startsWith('video/')) return true;
  // Fallback sur l'extension si contentType absent.
  return /\.(png|jpe?g|gif|webp|bmp|mp4|mov|webm|mkv|avi)$/i.test(attachment.name ?? '');
}

function drop(messageId) {
  const entry = cache.get(messageId);
  if (!entry) return;
  totalBytes -= entry.size;
  cache.delete(messageId);
}

function evictExpiredAndOverflow(now) {
  for (const [id, entry] of cache) {
    if (entry.expires <= now) drop(id);
  }
  // Map conserve l'ordre d'insertion → on supprime les plus anciens si dépassement.
  while (totalBytes > MAX_TOTAL_BYTES && cache.size) {
    const oldest = cache.keys().next().value;
    drop(oldest);
  }
}

// Télécharge et met en cache les médias d'un message (appelé à la création).
export async function cacheAttachments(message, now = Date.now()) {
  if (!message.guild || message.author?.bot) return;
  const media = [...message.attachments.values()].filter(isMedia);
  if (!media.length) return;

  const files = [];
  let size = 0;
  for (const att of media) {
    if (att.size > MAX_FILE_BYTES) continue;
    try {
      const res = await fetch(att.url);
      if (!res.ok) continue;
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > MAX_FILE_BYTES) continue;
      files.push({ name: att.name || 'fichier', buffer });
      size += buffer.length;
    } catch {
      // ignore les échecs de téléchargement
    }
  }
  if (!files.length) return;

  drop(message.id); // au cas où (edit/recache)
  cache.set(message.id, { files, size, expires: now + TTL_MS });
  totalBytes += size;
  evictExpiredAndOverflow(now);
}

// Récupère (et retire) les médias mis en cache pour un message supprimé.
export function takeCachedAttachments(messageId, now = Date.now()) {
  evictExpiredAndOverflow(now);
  const entry = cache.get(messageId);
  if (!entry) return [];
  drop(messageId);
  return entry.files;
}
