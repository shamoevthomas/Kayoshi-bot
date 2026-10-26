import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { getStatusKeywords } from '../../lib/store.js';
import { keywordsModal, disableStatusRole } from '../../lib/statusrole.js';

// /statut role : rôle donné aux membres qui ont un des mots-clés dans leur statut.
// Activer → formulaire des mots-clés (un par ligne, pré-rempli) ; désactiver → arrêt immédiat.
export default {
  data: new SlashCommandBuilder()
    .setName('statut')
    .setDescription('Rôles selon le statut des membres.')
    .addSubcommand((s) =>
      s
        .setName('role')
        .setDescription('Donner un rôle aux membres qui ont un mot-clé dans leur statut.')
        .addStringOption((o) =>
          o
            .setName('etat')
            .setDescription('Activer (puis choisir les mots-clés) ou désactiver le système')
            .setRequired(true)
            .addChoices({ name: 'Activer', value: 'on' }, { name: 'Désactiver', value: 'off' }),
        )
        .addRoleOption((o) => o.setName('role').setDescription('Le rôle à donner (par défaut : celui déjà choisi)')),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false),

  async execute(interaction) {
    const { guild } = interaction;
    if (interaction.options.getString('etat') === 'off') {
      return interaction.reply({
        content: disableStatusRole(guild.id)
          ? '✅ Rôle selon le statut **désactivé**. Les mots-clés sont gardés pour la prochaine fois ; les rôles déjà donnés ne sont pas retirés.'
          : 'ℹ️ Le rôle selon le statut n’était pas activé.',
        ephemeral: true,
      });
    }

    const saved = getStatusKeywords(guild.id);
    const role = interaction.options.getRole('role') ?? (saved?.roleId ? guild.roles.cache.get(saved.roleId) : null);
    if (!role) return interaction.reply({ content: '❌ Choisis le `role` à donner.', ephemeral: true });
    if (role.managed || role.id === guild.id) {
      return interaction.reply({ content: '❌ Ce rôle ne peut pas être donné (rôle d’intégration ou @everyone).', ephemeral: true });
    }
    const me = guild.members.me;
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({ content: '❌ Il me manque la permission **Gérer les rôles**.', ephemeral: true });
    }
    if (role.position >= me.roles.highest.position) {
      return interaction.reply({ content: `❌ Mon rôle doit être **au-dessus** de ${role} dans la liste des rôles.`, ephemeral: true });
    }
    // Les mots-clés se saisissent dans un formulaire (un par ligne).
    return interaction.showModal(keywordsModal(role.id, saved?.keywords ?? []));
  },
};
