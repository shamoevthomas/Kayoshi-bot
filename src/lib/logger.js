import { getGuildConfig } from './store.js';

// Couleurs par type d'événement (embeds).
export const Colors = {
  delete: 0xed4245,
  join: 0x57f287,
  leave: 0xed4245,
  role: 0x5865f2,
  channel: 0xfee75c,
  emoji: 0xeb459e,
  server: 0x5865f2,
};

// Envoie un embed dans le salon de logs configuré pour ce serveur (silencieux si non configuré).
export async function sendLog(guild, embed) {
  if (!guild) return;
  const { logChannelId } = getGuildConfig(guild.id);
  if (!logChannelId) return;
  const channel =
    guild.channels.cache.get(logChannelId) ??
    (await guild.channels.fetch(logChannelId).catch(() => null));
  if (!channel?.isTextBased()) return;
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
