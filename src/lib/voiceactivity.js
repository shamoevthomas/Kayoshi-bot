import { bumpVoiceActivity } from './store.js';

// Sessions vocales en cours : `${guildId}:${userId}` -> timestamp du dernier comptage.
const sessions = new Map();
const key = (guildId, userId) => `${guildId}:${userId}`;

export function startVoiceSession(guildId, userId) {
  sessions.set(key(guildId, userId), Date.now());
}

// Comptabilise le temps écoulé puis termine la session.
export function endVoiceSession(guildId, userId) {
  const k = key(guildId, userId);
  const start = sessions.get(k);
  if (start == null) return;
  sessions.delete(k);
  bumpVoiceActivity(guildId, userId, (Date.now() - start) / 1000);
}

// Comptabilise le temps écoulé pour toutes les sessions en cours SANS les terminer
// (garde le classement à jour pour les membres toujours connectés).
export function flushVoiceSessions() {
  const now = Date.now();
  for (const [k, start] of sessions) {
    const [guildId, userId] = k.split(':');
    bumpVoiceActivity(guildId, userId, (now - start) / 1000);
    sessions.set(k, now);
  }
}

// Au démarrage : démarre une session pour chaque membre déjà présent en vocal.
export function initVoiceSessions(client) {
  for (const [, guild] of client.guilds.cache) {
    for (const [, channel] of guild.channels.cache) {
      if (!channel.isVoiceBased?.() || channel.id === guild.afkChannelId) continue;
      for (const [, member] of channel.members) {
        if (!member.user.bot) startVoiceSession(guild.id, member.id);
      }
    }
  }
}
