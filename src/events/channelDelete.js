import { Events, EmbedBuilder, AuditLogEvent, ChannelType } from 'discord.js';
import { sendLog, Colors, findExecutor } from '../lib/logger.js';

const typeNames = {
  [ChannelType.GuildText]: 'Texte',
  [ChannelType.GuildVoice]: 'Vocal',
  [ChannelType.GuildCategory]: 'Catégorie',
  [ChannelType.GuildAnnouncement]: 'Annonces',
  [ChannelType.GuildStageVoice]: 'Conférence',
  [ChannelType.GuildForum]: 'Forum',
};

export default {
  name: Events.ChannelDelete,
  async execute(channel) {
    if (!channel.guild) return;
    const executor = await findExecutor(channel.guild, AuditLogEvent.ChannelDelete, channel.id);

    const embed = new EmbedBuilder()
      .setColor(Colors.delete)
      .setAuthor({ name: '🗑️ Salon supprimé' })
      .setDescription(`**${channel.name}**`)
      .addFields({ name: 'Type', value: typeNames[channel.type] ?? String(channel.type), inline: true })
      .setTimestamp();

    if (executor) embed.addFields({ name: 'Par', value: `${executor}`, inline: true });
    await sendLog(channel.guild, embed);
  },
};
