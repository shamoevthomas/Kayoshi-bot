import { Events, EmbedBuilder, AuditLogEvent } from 'discord.js';
import { sendLog, Colors, findExecutor } from '../lib/logger.js';

export default {
  name: Events.GuildRoleDelete,
  async execute(role) {
    if (!role.guild) return;
    const executor = await findExecutor(role.guild, AuditLogEvent.RoleDelete, role.id);

    const embed = new EmbedBuilder()
      .setColor(Colors.delete)
      .setAuthor({ name: '🗑️ Rôle supprimé' })
      .setDescription(`**${role.name}** (\`${role.id}\`)`)
      .addFields({ name: 'Couleur', value: `\`${role.hexColor}\``, inline: true })
      .setTimestamp();

    if (executor) embed.addFields({ name: 'Par', value: `${executor}`, inline: true });
    await sendLog(role.guild, embed);
  },
};
