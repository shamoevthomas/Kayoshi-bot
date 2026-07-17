import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { clearWarns } from '../../lib/store.js';

export default {
  data: new SlashCommandBuilder()
    .setName('clearwarns')
    .setDescription('Effacer TOUS les avertissements d’un membre.')
    .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false),

  async execute(interaction) {
    const target = interaction.options.getUser('membre');
    const count = clearWarns(interaction.guild.id, target.id);
    await interaction.reply({
      content: count
        ? `✅ ${count} avertissement(s) effacé(s) pour ${target}.`
        : `ℹ️ ${target} n’avait aucun avertissement.`,
      ephemeral: true,
    });
  },
};
