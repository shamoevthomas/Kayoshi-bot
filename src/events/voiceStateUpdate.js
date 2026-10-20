import { Events, EmbedBuilder } from 'discord.js';
import { sendVoiceLog, Colors } from '../lib/logger.js';
import { handleVoiceState } from '../lib/tempvoice.js';
import { startVoiceSession, endVoiceSession } from '../lib/voiceactivity.js';
import { onBotVoiceStateUpdate } from '../lib/voicestay.js';

// Un salon compte pour l'activité vocale s'il existe et n'est pas le salon AFK.
function counts(state) {
  return Boolean(state.channelId) && state.channelId !== state.guild.afkChannelId;
}

export default {
  name: Events.VoiceStateUpdate,
  async execute(oldState, newState) {
    const guild = newState.guild;
    const member = newState.member;
    // Le bot lui-même (/join) : déconnecté ou déplacé par quelqu'un → on s'aligne.
    if (newState.id === newState.client.user.id) return onBotVoiceStateUpdate(oldState, newState);
    if (member?.user?.bot) return;

    // Vocaux temporaires (création/suppression auto)
    await handleVoiceState(oldState, newState).catch((err) => console.error(err));

    // Suivi du temps vocal pour le classement (/configstat) et les stats (s?…) — AFK exclu.
    // Un changement de salon clôt la session du salon quitté (stats par salon).
    const wasCounting = counts(oldState);
    const isCounting = counts(newState);
    if (wasCounting && (!isCounting || oldState.channelId !== newState.channelId)) endVoiceSession(newState.guild.id, member.id);
    if (isCounting && (!wasCounting || oldState.channelId !== newState.channelId)) {
      startVoiceSession(newState.guild.id, member.id, newState.channelId);
    }

    // Connexion
    if (!oldState.channelId && newState.channelId) {
      return sendVoiceLog(
        guild,
        new EmbedBuilder()
          .setColor(Colors.join)
          .setAuthor({ name: '🔊 Connexion vocale' })
          .setDescription(`${member} a rejoint ${newState.channel}`)
          .setTimestamp(),
      );
    }

    // Déconnexion
    if (oldState.channelId && !newState.channelId) {
      return sendVoiceLog(
        guild,
        new EmbedBuilder()
          .setColor(Colors.leave)
          .setAuthor({ name: '🔇 Déconnexion vocale' })
          .setDescription(`${member} a quitté ${oldState.channel}`)
          .setTimestamp(),
      );
    }

    // Changement de salon
    if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
      return sendVoiceLog(
        guild,
        new EmbedBuilder()
          .setColor(Colors.join)
          .setAuthor({ name: '↔️ Changement de salon vocal' })
          .setDescription(`${member} : ${oldState.channel} → ${newState.channel}`)
          .setTimestamp(),
      );
    }
  },
};
