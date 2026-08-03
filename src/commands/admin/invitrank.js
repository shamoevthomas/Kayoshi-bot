import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { getInviteRanks, setInviteRanks } from '../../lib/store.js';
import { Colors } from '../../lib/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('invitrank')
    .setDescription("Paliers de rôles à débloquer selon le nombre d'invitations.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('ajouter')
        .setDescription('Ajouter/modifier un palier : X invitations → un rôle.')
        .addIntegerOption((opt) =>
          opt
            .setName('invitations')
            .setDescription("Nombre d'invitations requises pour ce palier")
            .setMinValue(1)
            .setRequired(true),
        )
        .addRoleOption((opt) =>
          opt.setName('role').setDescription('Rôle à donner à ce palier').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('retirer')
        .setDescription('Supprimer un palier existant.')
        .addIntegerOption((opt) =>
          opt
            .setName('invitations')
            .setDescription('Le seuil du palier à supprimer')
            .setMinValue(1)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('liste').setDescription('Voir tous les paliers configurés.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'ajouter') {
      const count = interaction.options.getInteger('invitations');
      const role = interaction.options.getRole('role');

      if (role.managed || role.id === interaction.guild.id) {
        return interaction.reply({
          content: '❌ Ce rôle ne peut pas être attribué (rôle géré par une intégration ou @everyone).',
          ephemeral: true,
        });
      }
      const me = interaction.guild.members.me;
      if (me && role.position >= me.roles.highest.position) {
        return interaction.reply({
          content: `⚠️ Le rôle ${role} est **au-dessus ou égal** au rôle le plus haut du bot. Je ne pourrai pas l'attribuer. Place mon rôle plus haut, puis réessaie.`,
          ephemeral: true,
        });
      }

      // Remplace tout palier avec le même seuil OU le même rôle, puis ajoute le nouveau.
      const ranks = getInviteRanks(guildId).filter((r) => r.count !== count && r.roleId !== role.id);
      ranks.push({ count, roleId: role.id });
      setInviteRanks(guildId, ranks);

      return interaction.reply({
        content: `✅ Palier enregistré : **${count} invitation(s)** → ${role}`,
        ephemeral: true,
      });
    }

    if (sub === 'retirer') {
      const count = interaction.options.getInteger('invitations');
      const ranks = getInviteRanks(guildId);
      const next = ranks.filter((r) => r.count !== count);
      if (next.length === ranks.length) {
        return interaction.reply({ content: `❌ Aucun palier à **${count} invitation(s)**.`, ephemeral: true });
      }
      setInviteRanks(guildId, next);
      return interaction.reply({ content: `🗑️ Palier de **${count} invitation(s)** supprimé.`, ephemeral: true });
    }

    // sub === 'liste'
    const ranks = getInviteRanks(guildId);
    if (!ranks.length) {
      return interaction.reply({
        content: 'Aucun palier configuré. Ajoute-en un avec `/invitrank ajouter`.',
        ephemeral: true,
      });
    }
    const embed = new EmbedBuilder()
      .setColor(Colors.role)
      .setTitle('🏆 Paliers d’invitations')
      .setDescription(
        ranks
          .sort((a, b) => a.count - b.count)
          .map((r) => `**${r.count}** invitation(s) → <@&${r.roleId}>`)
          .join('\n'),
      )
      .setFooter({ text: 'Le membre garde uniquement le rôle du palier le plus élevé atteint.' });
    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
