import { Events, EmbedBuilder } from 'discord.js';
import { sendLog, Colors } from '../lib/logger.js';
import { handleVoiceState } from '../lib/tempvoice.js';
import { startVoiceSession, endVoiceSession } from '../lib/voiceactivity.js';

// Un salon compte pour l'activité vocale s'il existe et n'est pas le salon AFK.
function counts(state) {
  return Boolean(state.channelId) && state.channelId !== state.guild.afkChannelId;
}

export default {
  name: Events.VoiceStateUpdate,
  async execute(oldState, newState) {
    const guild = newState.guild;
    const member = newState.member;
    if (member?.user?.bot) return;

    // Vocaux temporaires (création/suppression auto)
    await handleVoiceState(oldState, newState).catch((err) => console.error(err));

    // Suivi du temps vocal pour le classement (/configstat) — AFK exclu.
    const wasCounting = counts(oldState);
    const isCounting = counts(newState);
    if (!wasCounting && isCounting) startVoiceSession(newState.guild.id, member.id);
    else if (wasCounting && !isCounting) endVoiceSession(newState.guild.id, member.id);

    // Connexion
    if (!oldState.channelId && newState.channelId) {
      return sendLog(
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
      return sendLog(
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
      return sendLog(
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
