import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getAntiSpamConfig } from './store.js';
import { sendLog, Colors } from './logger.js';

// Fenêtres glissantes de messages par membre : `${guildId}:${userId}` -> [{ts,id,channelId}].
const buckets = new Map();
// Anti-double-sanction rapprochée.
const punished = new Map();

// Spam multi-salons : messages dans au moins MULTI_MIN_CHANNELS salons
// différents en moins de MULTI_WINDOW_MS → mute MULTI_TIMEOUT_MS.
export const MULTI_WINDOW_MS = 3000;
export const MULTI_MIN_CHANNELS = 2;
export const MULTI_TIMEOUT_MS = 60 * 60_000;
const multiBuckets = new Map();
const multiPunished = new Map();

// Traite un message pour l'anti-spam. Renvoie true si le message a été géré
// (spam détecté → supprimé), false sinon.
export async function handleAntiSpam(message) {
  if (!message.guild || message.author.bot || !message.member) return false;
  const config = getAntiSpamConfig(message.guild.id);
  if (!config?.enabled) return false;

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

  await sendLog(
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

  const arr = (multiBuckets.get(key) ?? []).filter((m) => now - m.ts < MULTI_WINDOW_MS);
  arr.push({ ts: now, id: message.id, channelId: message.channel.id });
  multiBuckets.set(key, arr);

  const channelIds = [...new Set(arr.map((m) => m.channelId))];
  if (channelIds.length < MULTI_MIN_CHANNELS) return false;

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

  await sendLog(
    message.guild,
    new EmbedBuilder()
      .setColor(Colors.delete)
      .setAuthor({ name: '🚫 Anti-spam multi-salons' })
      .setDescription(`${message.author} (${message.author.tag}) a posté dans plusieurs salons à la suite`)
      .addFields(
        {
          name: 'Détecté',
          value: `${arr.length} messages dans ${channelIds.length} salons en < ${MULTI_WINDOW_MS / 1000}s`,
          inline: true,
        },
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
