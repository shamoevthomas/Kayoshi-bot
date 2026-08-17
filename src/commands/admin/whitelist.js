import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { getServerBlacklist, addWhitelist, removeWhitelist } from '../../lib/store.js';
import { liftQuarantine } from '../../lib/blacklist.js';

export default {
  data: new SlashCommandBuilder()
    .setName('whitelist')
    .setDescription('Laisser passer un membre malgré la blacklist de serveurs.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('ajouter')
        .setDescription('Autoriser un membre (retire sa quarantaine).')
        .addUserOption((o) => o.setName('membre').setDescription('Le membre à autoriser').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('retirer')
        .setDescription('Retirer un membre de la whitelist.')
        .addUserOption((o) => o.setName('membre').setDescription('Le membre à retirer').setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName('liste').setDescription('Voir les membres whitelistés.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'liste') {
      const { whitelist } = getServerBlacklist(guildId);
      if (!whitelist.length) return interaction.reply({ content: 'Aucun membre whitelisté.', ephemeral: true });
      return interaction.reply({
        content: `✅ **Membres whitelistés :**\n${whitelist.map((id) => `• <@${id}>`).join('\n')}`,
        ephemeral: true,
      });
    }

    const user = interaction.options.getUser('membre');

    if (sub === 'ajouter') {
      await interaction.deferReply({ ephemeral: true });
      const added = addWhitelist(guildId, user.id);
      const lifted = await liftQuarantine(interaction.guild, user.id).catch(() => false);
      return interaction.editReply({
        content:
          (added ? `✅ ${user} est maintenant whitelisté.` : `ℹ️ ${user} était déjà whitelisté.`) +
          (lifted ? '\n🔓 Sa quarantaine a été retirée : il a de nouveau accès aux salons.' : ''),
      });
    }

    // retirer
    const removed = removeWhitelist(guildId, user.id);
    return interaction.reply({
      content: removed ? `✅ ${user} retiré de la whitelist.` : `ℹ️ ${user} n'était pas whitelisté.`,
      ephemeral: true,
    });
  },
};
