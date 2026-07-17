import { Events, EmbedBuilder } from 'discord.js';
import { sendLog, Colors } from '../lib/logger.js';
import { addMemberEvent } from '../lib/store.js';
import { sendGreeting } from '../lib/greetings.js';

export default {
  name: Events.GuildMemberRemove,
  async execute(member) {
    if (member.user?.bot) return;
    addMemberEvent(member.guild.id, 'leave', member.id);

    // Message de départ (si configuré)
    await sendGreeting(member.guild, 'leave', member).catch((err) => console.error(err));

    const embed = new EmbedBuilder()
      .setColor(Colors.leave)
      .setAuthor({ name: '📤 Départ', iconURL: member.user?.displayAvatarURL?.() })
      .setDescription(`**${member.user?.tag ?? 'Membre inconnu'}** a quitté le serveur`)
      .setTimestamp();

    if (member.joinedTimestamp) {
      embed.addFields({
        name: 'Avait rejoint',
        value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`,
        inline: true,
      });
    }

    await sendLog(member.guild, embed);
  },
};
