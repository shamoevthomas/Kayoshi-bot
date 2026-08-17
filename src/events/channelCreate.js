import { Events, EmbedBuilder, AuditLogEvent, ChannelType } from 'discord.js';
import { sendLog, Colors, findExecutor } from '../lib/logger.js';
import { applyQuarantineToChannel } from '../lib/blacklist.js';

const typeNames = {
  [ChannelType.GuildText]: 'Texte',
  [ChannelType.GuildVoice]: 'Vocal',
  [ChannelType.GuildCategory]: 'Catégorie',
  [ChannelType.GuildAnnouncement]: 'Annonces',
  [ChannelType.GuildStageVoice]: 'Conférence',
  [ChannelType.GuildForum]: 'Forum',
};

export default {
  name: Events.ChannelCreate,
  async execute(channel) {
    if (!channel.guild) return;
    // Étend le blocage de la quarantaine (blacklist) au nouveau salon.
    await applyQuarantineToChannel(channel).catch(() => {});
    const executor = await findExecutor(channel.guild, AuditLogEvent.ChannelCreate, channel.id);

    const embed = new EmbedBuilder()
      .setColor(Colors.channel)
      .setAuthor({ name: '📁 Salon créé' })
      .setDescription(`${channel} (**${channel.name}**)`)
      .addFields({ name: 'Type', value: typeNames[channel.type] ?? String(channel.type), inline: true })
      .setTimestamp();

    if (executor) embed.addFields({ name: 'Par', value: `${executor}`, inline: true });
    await sendLog(channel.guild, embed);
  },
};
