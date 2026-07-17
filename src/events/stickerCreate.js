import { Events, EmbedBuilder, AuditLogEvent } from 'discord.js';
import { sendLog, Colors, findExecutor } from '../lib/logger.js';

export default {
  name: Events.GuildStickerCreate,
  async execute(sticker) {
    const executor = await findExecutor(sticker.guild, AuditLogEvent.StickerCreate, sticker.id);

    const embed = new EmbedBuilder()
      .setColor(Colors.emoji)
      .setAuthor({ name: '🏷️ Sticker ajouté' })
      .setDescription(`**${sticker.name}**${sticker.description ? `\n${sticker.description}` : ''}`)
      .setTimestamp();

    if (sticker.url) embed.setThumbnail(sticker.url);
    if (executor) embed.addFields({ name: 'Par', value: `${executor}`, inline: true });
    await sendLog(sticker.guild, embed);
  },
};
