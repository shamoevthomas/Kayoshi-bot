import { SlashCommandBuilder } from 'discord.js';
import { divorce } from '../../lib/family.js';

export default {
  data: new SlashCommandBuilder()
    .setName('divorce')
    .setDescription('Annuler ton mariage virtuel en cours.')
    .setDMPermission(false),

  async execute(interaction) {
    const ex = divorce(interaction.guild.id, interaction.user.id);
    if (!ex) return interaction.reply({ content: 'ℹ️ Tu n’es pas marié(e).', ephemeral: true });
    await interaction.reply({ content: `💔 ${interaction.user} a divorcé de <@${ex}>.`, allowedMentions: { parse: [] } });
  },
};
