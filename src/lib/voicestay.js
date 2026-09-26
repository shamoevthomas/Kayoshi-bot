import { GatewayOpcodes } from 'discord.js';
import { getGuildConfig, setGuildConfig } from './store.js';

// Présence du bot dans un salon vocal (/join), même vide. Pas d'audio : une
// simple mise à jour d'état vocal sur la gateway suffit (pas de @discordjs/voice).
// Le salon est mémorisé (voiceStayChannelId) pour y revenir après un redémarrage.

export function getVoiceStayChannelId(guildId) {
  return getGuildConfig(guildId).voiceStayChannelId ?? null;
}

function sendVoiceState(guild, channelId) {
  guild.shard.send({
    op: GatewayOpcodes.VoiceStateUpdate,
    d: { guild_id: guild.id, channel_id: channelId, self_mute: false, self_deaf: true },
  });
}

// Attend que Discord confirme l'état vocal du bot (true si confirmé).
async function waitForVoice(guild, channelId, timeoutMs = 5000) {
  for (let waited = 0; waited < timeoutMs; waited += 250) {
    if ((guild.members.me?.voice.channelId ?? null) === channelId) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

// Rejoint le salon et le mémorise. Renvoie true si Discord a confirmé.
export async function joinAndStay(guild, channel) {
  setGuildConfig(guild.id, { voiceStayChannelId: channel.id });
  sendVoiceState(guild, channel.id);
  return waitForVoice(guild, channel.id);
}

// Quitte le vocal et oublie le salon.
export async function leaveVoice(guild) {
  setGuildConfig(guild.id, { voiceStayChannelId: null });
  sendVoiceState(guild, null);
  return waitForVoice(guild, null);
}

// (Re)connexion à la gateway : une nouvelle session fait perdre l'état vocal,
// on rejoint donc le salon mémorisé de chaque serveur.
export function rejoinVoiceChannels(client) {
  for (const [, guild] of client.guilds.cache) {
    const channelId = getVoiceStayChannelId(guild.id);
    if (!channelId || guild.members.me?.voice.channelId === channelId) continue;
    const channel = guild.channels.cache.get(channelId);
    if (!channel) {
      setGuildConfig(guild.id, { voiceStayChannelId: null }); // salon supprimé
      continue;
    }
    if (channel.joinable) sendVoiceState(guild, channelId);
  }
}

// Le bot a été déconnecté ou déplacé par quelqu'un : on respecte ce choix
// (déconnecté → on oublie le salon ; déplacé → le nouveau salon est mémorisé).
export function onBotVoiceStateUpdate(oldState, newState) {
  const guild = newState.guild;
  const stayId = getVoiceStayChannelId(guild.id);
  if (!stayId || newState.channelId === stayId || oldState.channelId === newState.channelId) return;
  setGuildConfig(guild.id, { voiceStayChannelId: newState.channelId ?? null });
}
