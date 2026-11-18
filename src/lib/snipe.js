import { AttachmentBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getStatusKeywords, getTagRoleConfig } from './store.js';

// « +snipe » (staff avec « Gérer les messages », et membres qui ont le rôle du statut ou du tag) : réaffiche le dernier
// message supprimé du salon ; « +snipe 2 » l'avant-dernier… jusqu'à « +snipe 5 ». Avec ses images/vidéos si elles
// avaient été mises en cache (lib/attachmentCache.js). En mémoire seulement : les 5 derniers par salon, gardés 1 h,
// 30 Mo de fichiers au plus en tout. Si la réponse du bot est supprimée (par le staff, Crown…), le message snipé est
// oublié : on ne peut plus le réafficher. Les messages « +snipe » eux-mêmes ne sont jamais gardés.
const TTL_MS = 60 * 60_000;
const MAX_TOTAL_BYTES = 30 * 1024 * 1024;
const MAX_PER_CHANNEL = 5;
const deleted = new Map(); // channelId → [entrée, …] du plus récent au plus ancien
const replies = new Map(); // message du bot → { channelId, entry } (les 200 derniers snipes)
let totalBytes = 0;

function removeEntry(channelId, entry) {
  const list = deleted.get(channelId);
  const i = list?.indexOf(entry) ?? -1;
  if (i < 0) return;
  list.splice(i, 1);
  totalBytes -= entry.size;
  if (!list.length) deleted.delete(channelId);
}

// Appelé par messageDelete. files = [{ name, buffer }] (pièces jointes mises en cache).
export function rememberDeleted(message, files = []) {
  if (!message.guild || message.author?.bot) return;
  if (!message.content && !files.length) return; // message inconnu du bot (non mis en cache)
  if (/^\+snipe(\s+\d+)?$/i.test(message.content?.trim() ?? '')) return; // la commande elle-même
  const size = files.reduce((n, f) => n + f.buffer.length, 0);
  const entry = {
    content: message.content ?? '',
    author: message.author ? { id: message.author.id, tag: message.author.tag, avatar: message.author.displayAvatarURL() } : null,
    createdAt: message.createdTimestamp ?? null,
    deletedAt: Date.now(),
    files,
    size,
  };
  // Le salon passe en dernier dans l'ordre de la Map : les plus anciens restent devant, oubliés en premier.
  const list = deleted.get(message.channelId) ?? [];
  deleted.delete(message.channelId);
  deleted.set(message.channelId, list);
  list.unshift(entry);
  totalBytes += size;
  while (list.length > MAX_PER_CHANNEL) removeEntry(message.channelId, list.at(-1));
  // Trop de fichiers en mémoire : on oublie les messages des salons les moins récents.
  while (totalBytes > MAX_TOTAL_BYTES && deleted.size > 1) {
    const [oldest, items] = deleted.entries().next().value;
    removeEntry(oldest, items.at(-1));
  }
}

// La réponse d'un snipe a été supprimée : le message snipé est oublié.
export function forgetSnipe(messageId) {
  const snipe = replies.get(messageId);
  if (!snipe) return;
  replies.delete(messageId);
  removeEntry(snipe.channelId, snipe.entry);
}

function canSnipe(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.ManageMessages)) return true;
  const roles = [getStatusKeywords(member.guild.id)?.roleId, getTagRoleConfig(member.guild.id)?.roleId].filter(Boolean);
  return roles.some((id) => member.roles.cache.has(id));
}

export async function handleSnipeCommand(message) {
  if (!message.guild || message.author.bot) return false;
  const match = message.content.trim().match(/^\+snipe(?:\s+(\d+))?$/i);
  if (!match) return false;
  // Réservé au staff et aux membres qui ont le rôle du statut ou du tag (Loyal sur Hanami) : les autres sont ignorés.
  if (!canSnipe(message.member)) return true;
  const rank = Math.max(1, Number(match[1] ?? 1));
  const reply = (content) => message.reply({ content, allowedMentions: { repliedUser: false } }).catch(() => {});
  if (rank > MAX_PER_CHANNEL) {
    await reply(`❌ Je ne garde que les ${MAX_PER_CHANNEL} derniers messages supprimés : \`+snipe 1\` à \`+snipe ${MAX_PER_CHANNEL}\`.`);
    return true;
  }
  // Les messages supprimés il y a plus d'1 h sont oubliés.
  for (const entry of [...(deleted.get(message.channelId) ?? [])]) {
    if (Date.now() - entry.deletedAt > TTL_MS) removeEntry(message.channelId, entry);
  }
  const list = deleted.get(message.channelId) ?? [];
  const entry = list[rank - 1];
  if (!entry) {
    await reply(
      list.length
        ? `🔍 Seulement **${list.length}** message(s) supprimé(s) dans ce salon depuis 1 h : \`+snipe ${list.length}\` au plus.`
        : '🔍 Aucun message supprimé dans ce salon depuis 1 h.',
    );
    return true;
  }
  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setAuthor({ name: entry.author?.tag ?? 'Auteur inconnu', iconURL: entry.author?.avatar })
    .setDescription(entry.content ? entry.content.slice(0, 4000) : '*(pas de texte)*')
    .addFields(
      { name: 'Auteur', value: entry.author ? `<@${entry.author.id}>` : 'Inconnu', inline: true },
      { name: 'Supprimé', value: `<t:${Math.floor(entry.deletedAt / 1000)}:R>`, inline: true },
    )
    .setFooter({ text: `🔍 Snipe${rank > 1 ? ` n°${rank} (${rank === 2 ? 'avant-dernier' : `${rank}ᵉ en partant du dernier`})` : ''} · réservé au staff` });
  if (entry.createdAt) embed.setTimestamp(entry.createdAt);
  const files = entry.files.map((f) => new AttachmentBuilder(f.buffer, { name: f.name }));
  const image = entry.files.find((f) => /\.(png|jpe?g|gif|webp)$/i.test(f.name));
  if (image) embed.setImage(`attachment://${image.name}`);
  const sent = await message.reply({ embeds: [embed], files, allowedMentions: { parse: [], repliedUser: false } }).catch(() => null);
  if (sent) {
    replies.set(sent.id, { channelId: message.channelId, entry });
    if (replies.size > 200) replies.delete(replies.keys().next().value);
  }
  return true;
}
