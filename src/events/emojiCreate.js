import { Events, EmbedBuilder, AuditLogEvent } from 'discord.js';
import { sendLog, Colors, findExecutor } from '../lib/logger.js';

export default {
  name: Events.GuildEmojiCreate,
  async execute(emoji) {
    const executor = await findExecutor(emoji.guild, AuditLogEvent.EmojiCreate, emoji.id);

    const embed = new EmbedBuilder()
      .setColor(Colors.emoji)
      .setAuthor({ name: '😀 Emoji ajouté' })
      .setDescription(`${emoji} \`:${emoji.name}:\``)
      .setThumbnail(emoji.imageURL())
      .setTimestamp();

    if (executor) embed.addFields({ name: 'Par', value: `${executor}`, inline: true });
    await sendLog(emoji.guild, embed);
  },
};
