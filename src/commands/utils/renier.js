import { SlashCommandBuilder } from 'discord.js';
import { removeAdoption } from '../../lib/family.js';

export default {
  data: new SlashCommandBuilder()
    .setName('renier')
    .setDescription('Renier (abandonner) un enfant que tu as adopté (virtuel).')
    .addUserOption((o) => o.setName('membre').setDescription('L’enfant à renier').setRequired(true))
    .setDMPermission(false),

  async execute(interaction) {
    const child = interaction.options.getUser('membre');
    if (!removeAdoption(interaction.guild.id, interaction.user.id, child.id)) {
      return interaction.reply({ content: `❌ ${child} n’est pas ton enfant adoptif.`, ephemeral: true });
    }
    await interaction.reply({ content: `💔 ${interaction.user} a renié ${child}… Ce n’est plus son enfant.`, allowedMentions: { parse: [] } });
  },
};
