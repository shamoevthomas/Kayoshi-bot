import { Events, EmbedBuilder, AuditLogEvent } from 'discord.js';
import { sendLog, Colors, findExecutor } from '../lib/logger.js';
import { noteAction } from '../lib/antinuke.js';
import { guardRoleCreate } from '../lib/roleguard.js';
import { guardExternalAppsRole } from '../lib/externalapps.js';

export default {
  name: Events.GuildRoleCreate,
  async execute(role) {
    if (!role.guild) return;
    // Anti-nuke : rôle créé avec des permissions de staff → supprimé.
    guardRoleCreate(role).catch((err) => console.error('[anti-nuke rôles]', err));
    // « Utiliser des applications externes » : réservée au rôle Crown (Hanami).
    guardExternalAppsRole(role).catch((err) => console.error('[applications externes]', err));
    const executor = await findExecutor(role.guild, AuditLogEvent.RoleCreate, role.id);
    // Anti-nuke : suppressions / créations en masse.
    noteAction(role.guild, executor, 'roleCreate').catch(() => {});

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
