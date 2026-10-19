import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getAntiSpamConfig } from './store.js';
import { sendSanctionLog, Colors } from './logger.js';

// Fenêtres glissantes de messages par membre : `${guildId}:${userId}` -> [{ts,id,channelId}].
const buckets = new Map();
// Anti-double-sanction rapprochée.
const punished = new Map();

// Spam multi-salons, en moins de MULTI_WINDOW_MS → mute MULTI_TIMEOUT_MS :
// - le même message (copier-coller) dans au moins MULTI_SAME_CHANNELS salons différents ;
// - ou des messages dans au moins MULTI_MIN_CHANNELS salons différents.
export const MULTI_WINDOW_MS = 10_000;
export const MULTI_SAME_CHANNELS = 2;
export const MULTI_MIN_CHANNELS = 3;
export const MULTI_TIMEOUT_MS = 60 * 60_000;
const multiBuckets = new Map();
const multiPunished = new Map();

// Salon ignoré par /antispam ignorer : le salon lui-même, sa catégorie, ou pour
// un fil, son salon parent (et la catégorie de celui-ci).
export function isIgnoredChannel(channel, ignoredIds) {
  if (!ignoredIds?.length) return false;
  return [channel.id, channel.parentId, channel.parent?.parentId].some((id) => id && ignoredIds.includes(id));
}

// Empreinte d'un message pour reconnaître un copier-coller : texte normalisé +
// pièces jointes (nom et taille). null si le message n'a ni texte ni fichier.
function fingerprint(message) {
  const text = message.content.trim().toLowerCase().replace(/\s+/g, ' ');
  const files = [...message.attachments.values()].map((a) => `${a.name}:${a.size}`).join(',');
  return text || files ? `${text}|${files}` : null;
}

// Traite un message pour l'anti-spam. Renvoie true si le message a été géré
// (spam détecté → supprimé), false sinon.
export async function handleAntiSpam(message) {
  if (!message.guild || message.author.bot || !message.member) return false;
  const config = getAntiSpamConfig(message.guild.id);
  if (!config?.enabled) return false;
  if (isIgnoredChannel(message.channel, config.ignoredChannelIds)) return false;

  // Exemptions : le staff (Gérer les messages) et les rôles exemptés.
  if (message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return false;
  if (config.exemptRoleIds?.some((id) => message.member.roles.cache.has(id))) return false;

  if (await handleMultiChannelSpam(message)) return true;

  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((m) => now - m.ts < config.intervalMs);
  arr.push({ ts: now, id: message.id, channelId: message.channel.id });
  buckets.set(key, arr);

  if (arr.length < config.maxMessages) return false;

  // Spam confirmé — éviter de re-sanctionner en boucle.
  const last = punished.get(key) ?? 0;
  if (now - last < config.intervalMs) {
    await message.delete().catch(() => {});
    return true;
  }
  punished.set(key, now);
  buckets.set(key, []);

  // Supprime les messages récents du spammeur.
  for (const m of arr) {
    const ch = message.guild.channels.cache.get(m.channelId);
    if (ch?.messages) await ch.messages.delete(m.id).catch(() => {});
  }

  // Mute temporaire (timeout) si configuré et possible.
  let muted = false;
  if (config.timeoutMs > 0 && message.member.moderatable) {
    muted = await message.member
      .timeout(config.timeoutMs, 'Anti-spam : messages trop rapides')
      .then(() => true)
      .catch(() => false);
  }

  const warn = await message.channel.send(`⚠️ ${message.author}, arrête le **spam** !`).catch(() => null);
  if (warn) setTimeout(() => warn.delete().catch(() => {}), 5000);

  await sendSanctionLog(
    message.guild,
    new EmbedBuilder()
      .setColor(Colors.delete)
      .setAuthor({ name: '🚫 Anti-spam' })
      .setDescription(`${message.author} (${message.author.tag}) a spammé dans ${message.channel}`)
      .addFields(
        { name: 'Détecté', value: `${arr.length} messages en < ${Math.round(config.intervalMs / 1000)}s`, inline: true },
        {
          name: 'Sanction',
          value: muted ? `🔇 mute ${Math.round(config.timeoutMs / 60000)} min + messages supprimés` : 'messages supprimés',
          inline: true,
        },
      )
      .setTimestamp(),
  );
  return true;
}

// Spam multi-salons (appelé par handleAntiSpam, donc soumis aux mêmes
// activation et exemptions). Renvoie true si le message a été géré.
async function handleMultiChannelSpam(message) {
  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();

  // Messages de la même rafale arrivés juste après la sanction : suppression seule.
  if (now - (multiPunished.get(key) ?? 0) < 10_000) {
    await message.delete().catch(() => {});
    return true;
  }

  const print = fingerprint(message);
  const arr = (multiBuckets.get(key) ?? []).filter((m) => now - m.ts < MULTI_WINDOW_MS);
  arr.push({ ts: now, id: message.id, channelId: message.channel.id, print });
  multiBuckets.set(key, arr);

  const channelIds = [...new Set(arr.map((m) => m.channelId))];
  const sameChannels = print ? new Set(arr.filter((m) => m.print === print).map((m) => m.channelId)).size : 0;
  if (sameChannels < MULTI_SAME_CHANNELS && channelIds.length < MULTI_MIN_CHANNELS) return false;
  const detected =
    sameChannels >= MULTI_SAME_CHANNELS
      ? `le même message dans ${sameChannels} salons en < ${MULTI_WINDOW_MS / 1000}s`
      : `${arr.length} messages dans ${channelIds.length} salons en < ${MULTI_WINDOW_MS / 1000}s`;

  multiPunished.set(key, now);
  multiBuckets.delete(key);

  // Supprime les messages de la rafale dans tous les salons touchés.
  for (const m of arr) {
    const ch = message.guild.channels.cache.get(m.channelId);
    if (ch?.messages) await ch.messages.delete(m.id).catch(() => {});
  }

  let muted = false;
  if (message.member.moderatable) {
    muted = await message.member
      .timeout(MULTI_TIMEOUT_MS, 'Anti-spam : messages dans plusieurs salons')
      .then(() => true)
      .catch(() => false);
  }

  const warn = await message.channel
    .send(`⚠️ ${message.author}, pas de **spam dans plusieurs salons** !${muted ? ' Mute **1 h**.' : ''}`)
    .catch(() => null);
  if (warn) setTimeout(() => warn.delete().catch(() => {}), 5000);

  await sendSanctionLog(
    message.guild,
    new EmbedBuilder()
      .setColor(Colors.delete)
      .setAuthor({ name: '🚫 Anti-spam multi-salons' })
      .setDescription(`${message.author} (${message.author.tag}) a posté dans plusieurs salons à la suite`)
      .addFields(
        { name: 'Détecté', value: detected, inline: true },
        {
          name: 'Sanction',
          value: muted
            ? `🔇 mute ${MULTI_TIMEOUT_MS / 60000} min + messages supprimés`
            : 'messages supprimés (mute impossible : rôle trop haut ou permission manquante)',
          inline: true,
        },
        { name: 'Salons', value: channelIds.map((id) => `<#${id}>`).join(' ') },
      )
      .setTimestamp(),
  );
  return true;
}
