import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { getStatutRules, addStatutRule, removeStatutRule } from '../../lib/store.js';
import { sweepAutoRolesGuild } from '../../lib/autoroles.js';

export default {
  data: new SlashCommandBuilder()
    .setName('statut')
    .setDescription('Donner un rôle aux membres qui ont un mot-clé dans leur statut (plusieurs possibles).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('ajouter')
        .setDescription('Ajouter un mot-clé qui donne un rôle.')
        .addStringOption((o) => o.setName('mot_cle').setDescription('Le mot-clé à détecter dans le statut').setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('Le rôle à donner').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('retirer')
        .setDescription('Retirer un mot-clé.')
        .addStringOption((o) => o.setName('mot_cle').setDescription('Le mot-clé à retirer').setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('(Facultatif) préciser le rôle si le mot-clé en a plusieurs')),
    )
    .addSubcommand((sub) => sub.setName('liste').setDescription('Voir les mots-clés configurés.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'liste') {
      const rules = getStatutRules(guildId);
      if (!rules.length) return interaction.reply({ content: 'Aucun mot-clé configuré.', ephemeral: true });
      const lines = rules.map((r) => `• \`${r.keyword}\` → <@&${r.roleId}>`);
      return interaction.reply({ content: `📝 **Mots-clés de statut :**\n${lines.join('\n')}`, ephemeral: true });
    }

    if (sub === 'retirer') {
      const keyword = interaction.options.getString('mot_cle').trim();
      const role = interaction.options.getRole('role');
      const n = removeStatutRule(guildId, keyword, role?.id ?? null);
      return interaction.reply({
        content: n ? `✅ ${n} règle(s) retirée(s) pour \`${keyword.toLowerCase()}\`.` : `ℹ️ Aucun mot-clé \`${keyword.toLowerCase()}\` trouvé.`,
        ephemeral: true,
      });
    }

    // ajouter
    const keyword = interaction.options.getString('mot_cle').trim();
    const role = interaction.options.getRole('role');
    const me = interaction.guild.members.me;

    if (role.id === interaction.guild.id) {
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
    if (!keyword) {
      return interaction.reply({ content: '❌ Mot-clé vide.', ephemeral: true });
    }

    const added = addStatutRule(guildId, keyword, role.id);
    if (!added) {
      return interaction.reply({ content: `ℹ️ La règle \`${keyword.toLowerCase()}\` → ${role} existe déjà.`, ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    // Applique tout de suite aux membres en ligne connus.
    await sweepAutoRolesGuild(interaction.guild).catch(() => {});
    return interaction.editReply({
      content:
        `✅ Ajouté : les membres avec **\`${keyword.toLowerCase()}\`** dans leur statut reçoivent ${role}.\n` +
        `_(Fonctionne pour les membres en ligne ; le rôle est retiré dès que le mot-clé disparaît.)_`,
    });
  },
};
