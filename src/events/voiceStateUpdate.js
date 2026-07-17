import { Events, EmbedBuilder } from 'discord.js';
import { sendLog, Colors } from '../lib/logger.js';
import { handleVoiceState } from '../lib/tempvoice.js';

export default {
  name: Events.VoiceStateUpdate,
  async execute(oldState, newState) {
    const guild = newState.guild;
    const member = newState.member;
    if (member?.user?.bot) return;

    // Vocaux temporaires (création/suppression auto)
    await handleVoiceState(oldState, newState).catch((err) => console.error(err));

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
