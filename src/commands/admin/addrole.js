import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { sendLog, Colors } from '../../lib/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('addrole')
    .setDescription('Ajouter un rôle à un membre.')
    .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true))
    .addRoleOption((o) => o.setName('role').setDescription('Le rôle à ajouter').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false),

  async execute(interaction) {
    const guild = interaction.guild;
    const target = interaction.options.getUser('membre');
    const role = interaction.options.getRole('role');
    const member = await guild.members.fetch(target.id).catch(() => null);
    if (!member) return interaction.reply({ content: '❌ Membre introuvable.', ephemeral: true });

    if (role.id === guild.id) {
      return interaction.reply({ content: '❌ Impossible d’ajouter le rôle @everyone.', ephemeral: true });
    }
    if (role.managed) {
      return interaction.reply({ content: '❌ Ce rôle est géré par une intégration, impossible de l’attribuer manuellement.', ephemeral: true });
    }
    // Hiérarchie : le rôle doit être sous le rôle le plus haut du bot…
    const me = guild.members.me;
    if (role.position >= me.roles.highest.position) {
      return interaction.reply({ content: `❌ Le rôle ${role} est au-dessus de mon rôle le plus haut, je ne peux pas le donner.`, ephemeral: true });
    }
    // …et sous celui de l'auteur (sauf propriétaire), pour qu'un modo ne puisse pas donner plus haut que lui.
    if (interaction.user.id !== guild.ownerId && role.position >= interaction.member.roles.highest.position) {
      return interaction.reply({ content: `❌ Le rôle ${role} est au-dessus (ou égal à) ton rôle le plus haut.`, ephemeral: true });
    }
    if (member.roles.cache.has(role.id)) {
      return interaction.reply({ content: `↪️ ${target} a déjà le rôle ${role}.`, ephemeral: true });
    }

    await member.roles.add(role, `/addrole par ${interaction.user.tag}`);

    await sendLog(
      guild,
      new EmbedBuilder()
        .setColor(Colors.role)
        .setAuthor({ name: '➕ Rôle ajouté' })
        .setDescription(`${role} ajouté à ${target}`)
        .addFields({ name: 'Par', value: `${interaction.user}`, inline: true })
        .setTimestamp(),
    );

    await interaction.reply({ content: `✅ Rôle ${role} ajouté à ${target}.`, ephemeral: true });
  },
};
