import { Events, EmbedBuilder, AuditLogEvent } from 'discord.js';
import { sendLog, Colors, findAuditEntry } from '../lib/logger.js';

export default {
  name: Events.GuildBanAdd,
  async execute(ban) {
    const guild = ban.guild;
    const entry = await findAuditEntry(guild, AuditLogEvent.MemberBanAdd, ban.user.id);

    // Évite le doublon : la commande /ban du bot loggue déjà elle-même.
    if (entry?.executor?.id === guild.client.user.id) return;

    const embed = new EmbedBuilder()
      .setColor(Colors.delete)
      .setAuthor({ name: '🔨 Bannissement' })
      .setDescription(`${ban.user.tag} (\`${ban.user.id}\`)`)
      .addFields(
        { name: 'Raison', value: entry?.reason || ban.reason || 'Aucune raison précisée' },
        { name: 'Par', value: entry?.executor ? `${entry.executor}` : 'Inconnu', inline: true },
      )
      .setTimestamp();

    await sendLog(guild, embed);
  },
};
