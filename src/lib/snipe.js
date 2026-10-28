import { AttachmentBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';

// « +snipe » (staff : permission « Gérer les messages ») : réaffiche le dernier message supprimé du salon,
// avec ses images/vidéos si elles avaient été mises en cache (lib/attachmentCache.js).
// En mémoire seulement : un message par salon, gardé 1 h, 30 Mo de fichiers au plus en tout.
const TTL_MS = 60 * 60_000;
const MAX_TOTAL_BYTES = 30 * 1024 * 1024;
const lastDeleted = new Map(); // channelId → { content, author, createdAt, deletedAt, files, size }
let totalBytes = 0;

function drop(channelId) {
  const entry = lastDeleted.get(channelId);
  if (!entry) return;
  totalBytes -= entry.size;
  lastDeleted.delete(channelId);
}

// Appelé par messageDelete. files = [{ name, buffer }] (pièces jointes mises en cache).
export function rememberDeleted(message, files = []) {
  if (!message.guild || message.author?.bot) return;
  if (!message.content && !files.length) return; // message inconnu du bot (non mis en cache)
  drop(message.channelId);
  const size = files.reduce((n, f) => n + f.buffer.length, 0);
  lastDeleted.set(message.channelId, {
    content: message.content ?? '',
    author: message.author ? { id: message.author.id, tag: message.author.tag, avatar: message.author.displayAvatarURL() } : null,
    createdAt: message.createdTimestamp ?? null,
    deletedAt: Date.now(),
    files,
    size,
  });
  totalBytes += size;
  // Trop de fichiers en mémoire : on oublie les plus anciens (Map = ordre d'insertion).
  while (totalBytes > MAX_TOTAL_BYTES && lastDeleted.size > 1) drop(lastDeleted.keys().next().value);
}

export async function handleSnipeCommand(message) {
  if (!message.guild || message.author.bot || message.content.trim().toLowerCase() !== '+snipe') return false;
  // Réservé au staff : les autres sont ignorés sans réponse.
  if (!message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) return true;
  const entry = lastDeleted.get(message.channelId);
  if (!entry || Date.now() - entry.deletedAt > TTL_MS) {
    drop(message.channelId);
    await message.reply({ content: '🔍 Aucun message supprimé dans ce salon depuis 1 h.', allowedMentions: { repliedUser: false } }).catch(() => {});
    return true;
  }
  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setAuthor({ name: entry.author?.tag ?? 'Auteur inconnu', iconURL: entry.author?.avatar })
    .setDescription(entry.content ? entry.content.slice(0, 4000) : '*(pas de texte)*')
    .addFields({ name: 'Auteur', value: entry.author ? `<@${entry.author.id}>` : 'Inconnu', inline: true }, { name: 'Supprimé', value: `<t:${Math.floor(entry.deletedAt / 1000)}:R>`, inline: true })
    .setFooter({ text: '🔍 Snipe · réservé au staff' });
  if (entry.createdAt) embed.setTimestamp(entry.createdAt);
  const files = entry.files.map((f) => new AttachmentBuilder(f.buffer, { name: f.name }));
  const image = entry.files.find((f) => /\.(png|jpe?g|gif|webp)$/i.test(f.name));
  if (image) embed.setImage(`attachment://${image.name}`);
  await message.reply({ embeds: [embed], files, allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
  return true;
}
