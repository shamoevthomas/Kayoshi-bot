import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { getWarns } from '../../lib/store.js';
import { buildWarnPanel } from '../../lib/moderation.js';

export default {
  data: new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('Voir les avertissements d’un membre.')
    .addUserOption((o) => o.setName('membre').setDescription('Le membre à consulter').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false),

  async execute(interaction) {
    const target = interaction.options.getUser('membre');
    const warns = getWarns(interaction.guild.id, target.id);
    const panel = buildWarnPanel(target, warns);
    await interaction.reply({ ...panel, ephemeral: true });
  },
};
