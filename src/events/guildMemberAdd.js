import { Events, EmbedBuilder } from 'discord.js';
import { sendLog, Colors } from '../lib/logger.js';
import { addMemberEvent } from '../lib/store.js';
import { onMemberJoin } from '../lib/verification.js';
import { sendGreeting } from '../lib/greetings.js';

export default {
  name: Events.GuildMemberAdd,
  async execute(member) {
    if (member.user.bot) return;
    addMemberEvent(member.guild.id, 'join', member.id);

    // Vérification anti-bot (si configurée)
    await onMemberJoin(member).catch((err) => console.error(err));
    // Message de bienvenue (si configuré)
    await sendGreeting(member.guild, 'welcome', member).catch((err) => console.error(err));

    const embed = new EmbedBuilder()
      .setColor(Colors.join)
      .setAuthor({ name: '📥 Arrivée', iconURL: member.user.displayAvatarURL() })
      .setDescription(`${member} (${member.user.tag}) a rejoint le serveur`)
      .addFields({
        name: 'Compte créé',
        value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`,
        inline: true,
      })
      .setTimestamp();

    await sendLog(member.guild, embed);
  },
};
