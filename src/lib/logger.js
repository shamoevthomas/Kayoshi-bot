import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { getGuildConfig, setGuildConfig } from './store.js';

// Couleurs par type d'événement (embeds).
export const Colors = {
  delete: 0xed4245,
  edit: 0xfaa61a,
  join: 0x57f287,
  leave: 0xed4245,
  role: 0x5865f2,
  channel: 0xfee75c,
  emoji: 0xeb459e,
  server: 0x5865f2,
};

// Envoie un embed (+ éventuellement des fichiers) dans le salon de logs configuré
// pour ce serveur (silencieux si non configuré).
export async function sendLog(guild, embed, files = []) {
  if (!guild) return;
  const { logChannelId } = getGuildConfig(guild.id);
  if (!logChannelId) return;
  const channel =
    guild.channels.cache.get(logChannelId) ??
    (await guild.channels.fetch(logChannelId).catch(() => null));
  if (!channel?.isTextBased()) return;
  await channel.send({ embeds: [embed], files }).catch(() => {});
}

// Envoie un embed dans le salon dédié au suivi des invitations (/inviteconfig).
// Si aucun salon dédié n'est configuré, on retombe sur le salon de logs général.
export async function sendInviteLog(guild, embed, files = []) {
  if (!guild) return;
  const { inviteLogChannelId, logChannelId } = getGuildConfig(guild.id);
  const channelId = inviteLogChannelId ?? logChannelId;
  if (!channelId) return;
  const channel =
    guild.channels.cache.get(channelId) ??
    (await guild.channels.fetch(channelId).catch(() => null));
  if (!channel?.isTextBased()) return;
  await channel.send({ embeds: [embed], files }).catch(() => {});
}

// Envoie un embed dans le salon des sanctions (/sanction) : warn, mute, kick,
// ban, derank, anti-spam… Si aucun salon dédié n'est configuré (ou qu'il a été
// supprimé), on retombe sur le salon de logs général.
export async function sendSanctionLog(guild, embed, files = []) {
  if (!guild) return;
  const { sanctionChannelId, logChannelId } = getGuildConfig(guild.id);
  const channel =
    (sanctionChannelId &&
      (guild.channels.cache.get(sanctionChannelId) ??
        (await guild.channels.fetch(sanctionChannelId).catch(() => null)))) ||
    (logChannelId &&
      (guild.channels.cache.get(logChannelId) ?? (await guild.channels.fetch(logChannelId).catch(() => null))));
  if (!channel?.isTextBased()) return;
  await channel.send({ embeds: [embed], files }).catch(() => {});
}

// --- Logs vocaux : salon dédié « voc-logs » ---
// Créé automatiquement pour les serveurs qui ont un salon de logs : même catégorie
// et mêmes permissions que lui (le staff qui voit les logs voit les logs vocaux).
// S'il est supprimé, il est recréé au prochain log vocal.
const VOICE_LOG_NAME = 'voc-logs';
const RETRY_AFTER_FAILURE_MS = 10 * 60_000;
const voiceLogPending = new Map(); // guildId → Promise (une seule création à la fois)
const voiceLogFailedAt = new Map(); // guildId → horodatage du dernier échec de création

async function fetchChannel(guild, id) {
  if (!id) return null;
  return guild.channels.cache.get(id) ?? (await guild.channels.fetch(id).catch(() => null));
}

async function resolveVoiceLogChannel(guild) {
  const { voiceLogChannelId, logChannelId } = getGuildConfig(guild.id);
  const current = await fetchChannel(guild, voiceLogChannelId);
  if (current?.isTextBased()) return current;
  // Pas de salon de logs : pas de logs vocaux non plus.
  const logChannel = await fetchChannel(guild, logChannelId);
  if (!logChannel?.isTextBased()) return null;
  if (Date.now() - (voiceLogFailedAt.get(guild.id) ?? 0) < RETRY_AFTER_FAILURE_MS) return null;

  // Un « voc-logs » déjà présent (config perdue) est réutilisé plutôt que dupliqué.
  let channel = guild.channels.cache.find((c) => c.name === VOICE_LOG_NAME && c.type === ChannelType.GuildText);
  if (!channel) {
    const botId = guild.client.user.id;
    const overwrites = [...logChannel.permissionOverwrites.cache.values()]
      .filter((o) => o.id !== botId)
      .map((o) => ({ id: o.id, type: o.type, allow: o.allow, deny: o.deny }));
    overwrites.push({
      id: botId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks],
    });
    channel = await guild.channels
      .create({
        name: VOICE_LOG_NAME,
        type: ChannelType.GuildText,
        topic: 'Logs vocaux : connexions, déconnexions et changements de salon — Kayoshi.',
        parent: logChannel.parentId ?? null,
        permissionOverwrites: overwrites,
      })
      .catch((err) => {
        console.error('[voc-logs] création impossible :', err.message);
        voiceLogFailedAt.set(guild.id, Date.now());
        return null;
      });
  }
  if (channel) setGuildConfig(guild.id, { voiceLogChannelId: channel.id });
  return channel;
}

// Salons de logs à part (ex. « logs-boutique ») : réutilisé s'il existe (id gardé dans config[configKey],
// ou un salon du même nom), sinon créé à côté du salon de logs du serveur (/log) avec ses permissions
// (le staff qui voit les logs le voit), ou caché à @everyone s'il n'y a pas de salon de logs.
// Une seule création à la fois par salon. Renvoie le salon, ou null si impossible.
const extraLogPending = new Map(); // `${guildId}:${name}` → Promise
const extraLogFailedAt = new Map();

export function ensureExtraLogChannel(guild, { name, topic, configKey }) {
  const key = `${guild.id}:${name}`;
  if (!extraLogPending.has(key)) {
    extraLogPending.set(key, resolveExtraLogChannel(guild, key, name, topic, configKey).finally(() => extraLogPending.delete(key)));
  }
  return extraLogPending.get(key);
}

async function resolveExtraLogChannel(guild, key, name, topic, configKey) {
  const config = getGuildConfig(guild.id);
  const current = await fetchChannel(guild, config[configKey]);
  if (current?.isTextBased()) return current;
  let channel = guild.channels.cache.find((c) => c.name === name && c.type === ChannelType.GuildText);
  if (!channel) {
    if (Date.now() - (extraLogFailedAt.get(key) ?? 0) < RETRY_AFTER_FAILURE_MS) return null;
    const serverLogs = await fetchChannel(guild, config.logChannelId);
    const botId = guild.client.user.id;
    const overwrites = serverLogs
      ? [...serverLogs.permissionOverwrites.cache.values()]
          .filter((o) => o.id !== botId)
          .map((o) => ({ id: o.id, type: o.type, allow: o.allow, deny: o.deny }))
      : [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }];
    overwrites.push({ id: botId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks] });
    channel = await guild.channels
      .create({ name, type: ChannelType.GuildText, topic, parent: serverLogs?.parentId ?? null, permissionOverwrites: overwrites })
      .catch((err) => {
        console.error(`[${name}] création impossible :`, err.message);
        extraLogFailedAt.set(key, Date.now());
        return null;
      });
  }
  if (channel) setGuildConfig(guild.id, { [configKey]: channel.id });
  return channel;
}

// Salon des logs vocaux (créé s'il le faut), ou null.
export function ensureVoiceLogChannel(guild) {
  if (!voiceLogPending.has(guild.id)) {
    voiceLogPending.set(
      guild.id,
      resolveVoiceLogChannel(guild).finally(() => voiceLogPending.delete(guild.id)),
    );
  }
  return voiceLogPending.get(guild.id);
}

// Envoie un log vocal dans « voc-logs » ; si le salon ne peut pas être créé,
// on retombe sur le salon de logs général.
export async function sendVoiceLog(guild, embed) {
  if (!guild) return;
  const channel = await ensureVoiceLogChannel(guild).catch(() => null);
  if (!channel) return sendLog(guild, embed);
  await channel.send({ embeds: [embed] }).catch(() => {});
}

// Best-effort : retrouve l'auteur d'une action via les journaux d'audit.
// Nécessite la permission "Voir les journaux d'audit". Renvoie null si indisponible.
export async function findExecutor(guild, type, targetId) {
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 5 });
    const entry = logs.entries.find(
      (e) =>
        (!targetId || e.targetId === targetId) &&
        Date.now() - e.createdTimestamp < 10_000,
    );
    return entry?.executor ?? null;
  } catch {
    return null;
  }
}

// Comme findExecutor mais renvoie aussi la raison : { executor, reason } ou null.
export async function findAuditEntry(guild, type, targetId) {
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 5 });
    const entry = logs.entries.find(
      (e) => (!targetId || e.targetId === targetId) && Date.now() - e.createdTimestamp < 10_000,
    );
    if (!entry) return null;
    return { executor: entry.executor ?? null, reason: entry.reason ?? null };
  } catch {
    return null;
  }
}
