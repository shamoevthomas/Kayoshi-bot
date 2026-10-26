import { SlashCommandBuilder } from 'discord.js';
import { helpMessage } from '../../lib/help.js';

// Le catalogue des commandes et le menu par catégorie sont dans lib/help.js.
export default {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Aide du bot : choisis une catégorie pour voir ses commandes.')
    .setDMPermission(false),

  async execute(interaction) {
    await interaction.reply({ ...helpMessage(), ephemeral: true });
  },
};
