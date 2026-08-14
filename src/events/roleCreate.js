import { Events, EmbedBuilder, AuditLogEvent } from 'discord.js';
import { sendLog, Colors, findExecutor } from '../lib/logger.js';

export default {
  name: Events.GuildRoleCreate,
  async execute(role) {
    if (!role.guild) return;
    const executor = await findExecutor(role.guild, AuditLogEvent.RoleCreate, role.id);

    const embed = new EmbedBuilder()
      .setColor(role.color || Colors.role)
      .setAuthor({ name: '✳️ Rôle créé' })
      .setDescription(`${role} (**${role.name}**)`)
      .addFields({ name: 'Couleur', value: `\`${role.hexColor}\``, inline: true })
      .setTimestamp();

    if (executor) embed.addFields({ name: 'Par', value: `${executor}`, inline: true });
    await sendLog(role.guild, embed);
  },
};
