import { Events, EmbedBuilder, AuditLogEvent } from 'discord.js';
import { sendLog, Colors, findExecutor } from '../lib/logger.js';

export default {
  name: Events.GuildMemberUpdate,
  async execute(oldMember, newMember) {
    const guild = newMember.guild;
    const oldRoles = oldMember.roles.cache;
    const newRoles = newMember.roles.cache;
    const added = newRoles.filter((r) => !oldRoles.has(r.id));
    const removed = oldRoles.filter((r) => !newRoles.has(r.id));
    if (added.size === 0 && removed.size === 0) return;

    const executor = await findExecutor(guild, AuditLogEvent.MemberRoleUpdate, newMember.id);

    const embed = new EmbedBuilder()
      .setColor(Colors.role)
      .setAuthor({ name: '🎭 Changement de rôles' })
      .setDescription(`Membre : ${newMember} (${newMember.user.tag})`)
      .setTimestamp();

    if (added.size) {
      embed.addFields({ name: '➕ Ajoutés', value: added.map((r) => `${r}`).join(', ').slice(0, 1000) });
    }
    if (removed.size) {
      embed.addFields({ name: '➖ Retirés', value: removed.map((r) => `${r}`).join(', ').slice(0, 1000) });
    }
    if (executor) {
      embed.addFields({ name: 'Par', value: `${executor}`, inline: true });
    }

    await sendLog(guild, embed);
  },
};
