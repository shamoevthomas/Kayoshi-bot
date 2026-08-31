import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { getTagRoleConfig, setTagRoleConfig } from '../../lib/store.js';
import { sweepAutoRolesGuild } from '../../lib/autoroles.js';

export default {
  data: new SlashCommandBuilder()
    .setName('tagrole')
    .setDescription('Donner un rôle aux membres qui portent le tag du serveur.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('activer')
        .setDescription('Choisir le rôle donné aux membres qui portent le tag du serveur.')
        .addRoleOption((o) => o.setName('role').setDescription('Le rôle à donner').setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName('desactiver').setDescription('Désactiver le rôle de tag.'))
    .addSubcommand((sub) => sub.setName('voir').setDescription('Voir la configuration.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'voir') {
      const c = getTagRoleConfig(guildId);
      return interaction.reply({
        content: c?.roleId ? `🏷️ Rôle de tag : <@&${c.roleId}>` : '🔕 Aucun rôle de tag configuré.',
        ephemeral: true,
      });
    }

    if (sub === 'desactiver') {
      setTagRoleConfig(guildId, { roleId: null });
      return interaction.reply({ content: '🔕 Rôle de tag désactivé.', ephemeral: true });
    }

    // activer
    const role = interaction.options.getRole('role');
    const me = interaction.guild.members.me;
    if (role.id === guildId) {
      return interaction.reply({ content: '❌ Impossible d’utiliser @everyone.', ephemeral: true });
    }
    if (role.managed) {
      return interaction.reply({ content: `❌ Le rôle ${role} est géré par une intégration, impossible de l’attribuer.`, ephemeral: true });
    }
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({ content: '❌ Il me manque la permission **Gérer les rôles**.', ephemeral: true });
    }
    if (role.position >= me.roles.highest.position) {
      return interaction.reply({ content: `❌ Le rôle ${role} est au-dessus de mon rôle le plus haut. Déplace mon rôle plus haut.`, ephemeral: true });
    }

    setTagRoleConfig(guildId, { roleId: role.id });
    await interaction.deferReply({ ephemeral: true });

    // Applique tout de suite aux membres connus (réconciliation unifiée).
    await interaction.guild.members.fetch().catch(() => null);
    await sweepAutoRolesGuild(interaction.guild).catch(() => {});

    return interaction.editReply({
      content: `✅ Les membres qui portent le **tag du serveur** reçoivent ${role} (retiré seulement si aucune autre condition ne le donne).`,
    });
  },
};
