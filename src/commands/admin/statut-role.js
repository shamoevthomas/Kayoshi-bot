import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { getStatusRoleConfig, setStatusRoleConfig } from '../../lib/store.js';
import { sweepStatusRoles } from '../../lib/statusrole.js';

export default {
  data: new SlashCommandBuilder()
    .setName('statut-role')
    .setDescription('Donner un rôle aux membres qui ont un texte (ex: une invite) dans leur statut.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('activer')
        .setDescription('Configurer le texte à détecter dans le statut et le rôle à donner.')
        .addStringOption((opt) =>
          opt
            .setName('texte')
            .setDescription('Texte à détecter dans le statut (ex: .gg/ximi)')
            .setRequired(true),
        )
        .addRoleOption((opt) =>
          opt.setName('role').setDescription('Rôle à donner aux membres concernés').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('desactiver').setDescription('Désactiver le rôle automatique lié au statut.'),
    )
    .addSubcommand((sub) => sub.setName('voir').setDescription('Voir la configuration actuelle.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'voir') {
      const config = getStatusRoleConfig(interaction.guild.id);
      if (!config?.text || !config.roleId) {
        return interaction.reply({ content: 'ℹ️ Aucun rôle-statut configuré. Utilise `/statut-role activer`.', ephemeral: true });
      }
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setAuthor({ name: '📡 Rôle selon le statut' })
        .addFields(
          { name: 'Texte détecté', value: `\`${config.text}\``, inline: true },
          { name: 'Rôle attribué', value: `<@&${config.roleId}>`, inline: true },
        )
        .setFooter({ text: 'Le membre reçoit le rôle tant que le texte est dans son statut.' });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'desactiver') {
      setStatusRoleConfig(interaction.guild.id, null);
      return interaction.reply({ content: '✅ Rôle-statut désactivé. (Les rôles déjà donnés ne sont pas retirés.)', ephemeral: true });
    }

    // sub === 'activer'
    const texte = interaction.options.getString('texte').trim();
    const role = interaction.options.getRole('role');

    if (role.managed || role.id === interaction.guild.id) {
      return interaction.reply({ content: '❌ Ce rôle ne peut pas être attribué (rôle géré par une intégration ou @everyone).', ephemeral: true });
    }
    const me = interaction.guild.members.me;
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({ content: '❌ Il me manque la permission **Gérer les rôles**.', ephemeral: true });
    }
    if (role.position >= me.roles.highest.position) {
      return interaction.reply({ content: `❌ Mon rôle doit être **au-dessus** de ${role} dans la liste des rôles.`, ephemeral: true });
    }

    setStatusRoleConfig(interaction.guild.id, { text: texte, roleId: role.id });

    await interaction.reply({
      content: `✅ C'est configuré : tout membre avec \`${texte}\` dans son statut recevra ${role}.\n⏳ Application aux membres déjà en ligne…`,
      ephemeral: true,
    });

    // Applique immédiatement aux membres déjà en ligne (présences en cache).
    const { added } = await sweepStatusRoles(interaction.guild, { text: texte, roleId: role.id }).catch(() => ({ added: 0 }));
    await interaction.editReply({
      content: `✅ C'est configuré : tout membre avec \`${texte}\` dans son statut recevra ${role}.\n🎯 ${added} membre(s) déjà en ligne ont reçu le rôle.`,
    }).catch(() => {});
  },
};
