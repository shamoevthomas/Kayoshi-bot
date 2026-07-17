import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { sendLog, Colors } from '../../lib/logger.js';

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

    // Vérifie la hiérarchie : le rôle doit être sous le rôle le plus haut du bot
    const me = interaction.guild.members.me;
    if (role.position >= me.roles.highest.position) {
      return interaction.reply({ content: `❌ Le rôle ${role} est au-dessus de mon rôle le plus haut, je ne peux pas le gérer.`, ephemeral: true });
    }
    if (role.managed) {
      return interaction.reply({ content: '❌ Ce rôle est géré par une intégration, impossible de l’attribuer manuellement.', ephemeral: true });
    }

    const had = member.roles.cache.has(role.id);
    if (had) await member.roles.remove(role, `Par ${interaction.user.tag}`);
    else await member.roles.add(role, `Par ${interaction.user.tag}`);

    await sendLog(
      interaction.guild,
      new EmbedBuilder()
        .setColor(Colors.role)
        .setAuthor({ name: had ? '➖ Rôle retiré' : '➕ Rôle ajouté' })
        .setDescription(`${role} ${had ? 'retiré à' : 'ajouté à'} ${target}`)
        .addFields({ name: 'Par', value: `${interaction.user}`, inline: true })
        .setTimestamp(),
    );

    await interaction.reply({
      content: had ? `✅ Rôle ${role} retiré à ${target}.` : `✅ Rôle ${role} ajouté à ${target}.`,
      ephemeral: true,
    });
  },
};
