import { bumpVoiceActivity } from './store.js';
import { recordVoice } from './stats.js';

// Sessions vocales en cours : `${guildId}:${userId}` -> { since, channelId }
// (since = dernier comptage ; channelId = salon, pour les stats par salon).
const sessions = new Map();
const key = (guildId, userId) => `${guildId}:${userId}`;

// Compte le temps depuis le dernier comptage : classement de la semaine (/configstat) et stats (s?…).
function count(guildId, userId, session, now) {
  const seconds = (now - session.since) / 1000;
  bumpVoiceActivity(guildId, userId, seconds);
  recordVoice(guildId, userId, session.channelId, seconds, now);
}

export function startVoiceSession(guildId, userId, channelId) {
  sessions.set(key(guildId, userId), { since: Date.now(), channelId });
}

// Comptabilise le temps écoulé puis termine la session.
export function endVoiceSession(guildId, userId) {
  const k = key(guildId, userId);
  const session = sessions.get(k);
  if (!session) return;
  sessions.delete(k);
  count(guildId, userId, session, Date.now());
}

// Comptabilise le temps écoulé pour toutes les sessions en cours SANS les terminer
// (garde le classement et les stats à jour pour les membres toujours connectés).
export function flushVoiceSessions() {
  const now = Date.now();
  for (const [k, session] of sessions) {
    const [guildId, userId] = k.split(':');
    count(guildId, userId, session, now);
    session.since = now;
  }
}

// Au démarrage : démarre une session pour chaque membre déjà présent en vocal.
export function initVoiceSessions(client) {
  for (const [, guild] of client.guilds.cache) {
    for (const [, channel] of guild.channels.cache) {
      if (!channel.isVoiceBased?.() || channel.id === guild.afkChannelId) continue;
      for (const [, member] of channel.members) {
        if (!member.user.bot) startVoiceSession(guild.id, member.id, channel.id);
      }
    }
  }
}
