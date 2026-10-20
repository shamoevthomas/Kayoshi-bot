import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { sendLog, Colors } from '../../lib/logger.js';
import { roleCommandProblem } from '../../lib/roles.js';
import { getTempRole, removeTempRole } from '../../lib/store.js';

export default {
  data: new SlashCommandBuilder()
    .setName('removerole')
    .setDescription('Retirer un rôle à un membre.')
    .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true))
    .addRoleOption((o) => o.setName('role').setDescription('Le rôle à retirer').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false),

  async execute(interaction) {
    const guild = interaction.guild;
    const target = interaction.options.getUser('membre');
    const role = interaction.options.getRole('role');
    const member = await guild.members.fetch(target.id).catch(() => null);
    if (!member) return interaction.reply({ content: '❌ Membre introuvable.', ephemeral: true });

    const problem = roleCommandProblem(interaction, role, 'retirer');
    if (problem) return interaction.reply({ content: problem, ephemeral: true });
    if (!member.roles.cache.has(role.id)) {
      return interaction.reply({ content: `↪️ ${target} n’a pas le rôle ${role}.`, ephemeral: true });
    }

    await member.roles.remove(role, `/removerole par ${interaction.user.tag}`);
    // Rôle donné avec /roletempo : plus rien à retirer à la fin du temps.
    const wasTemporary = Boolean(getTempRole(guild.id, member.id, role.id));
    removeTempRole(guild.id, member.id, role.id);

    await sendLog(
      guild,
      new EmbedBuilder()
        .setColor(Colors.role)
        .setAuthor({ name: '➖ Rôle retiré' })
        .setDescription(`${role} retiré à ${target}${wasTemporary ? ' (rôle temporaire, avant la fin)' : ''}`)
        .addFields({ name: 'Par', value: `${interaction.user}`, inline: true })
        .setTimestamp(),
    );

    await interaction.reply({ content: `✅ Rôle ${role} retiré à ${target}.`, ephemeral: true });
  },
};
