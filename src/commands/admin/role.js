import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { sendLog, Colors } from '../../lib/logger.js';
import { roleCommandProblem } from '../../lib/roles.js';
import { getTempRole, removeTempRole } from '../../lib/store.js';

export default {
  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('Ajouter ou retirer un rôle à un membre (bascule).')
    .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true))
    .addRoleOption((o) => o.setName('role').setDescription('Le rôle à ajouter/retirer').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false),

  async execute(interaction) {
    const target = interaction.options.getUser('membre');
    const role = interaction.options.getRole('role');
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) return interaction.reply({ content: '❌ Membre introuvable.', ephemeral: true });

    // @everyone, rôle d'intégration, rôle au-dessus du bot ou de l'auteur (sauf propriétaire) : refusé.
    const problem = roleCommandProblem(interaction, role);
    if (problem) return interaction.reply({ content: problem, ephemeral: true });

    const had = member.roles.cache.has(role.id);
    if (had) await member.roles.remove(role, `Par ${interaction.user.tag}`);
    else await member.roles.add(role, `Par ${interaction.user.tag}`);
    // Rôle donné avec /roletempo et retiré avant la fin : plus rien à retirer plus tard.
    const wasTemporary = had && Boolean(getTempRole(interaction.guild.id, member.id, role.id));
    if (had) removeTempRole(interaction.guild.id, member.id, role.id);

    await sendLog(
      interaction.guild,
      new EmbedBuilder()
        .setColor(Colors.role)
        .setAuthor({ name: had ? '➖ Rôle retiré' : '➕ Rôle ajouté' })
        .setDescription(`${role} ${had ? 'retiré à' : 'ajouté à'} ${target}${wasTemporary ? ' (rôle temporaire, avant la fin)' : ''}`)
        .addFields({ name: 'Par', value: `${interaction.user}`, inline: true })
        .setTimestamp(),
    );

    await interaction.reply({
      content: had ? `✅ Rôle ${role} retiré à ${target}.` : `✅ Rôle ${role} ajouté à ${target}.`,
      ephemeral: true,
    });
  },
};
