import { SlashCommandBuilder } from 'discord.js';
import { openShop } from '../../lib/shop.js';

export default {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Ouvrir la boutique : achète des objets avec ton argent et vois ton inventaire.')
    .setDMPermission(false),

  async execute(interaction) {
    await openShop(interaction);
  },
};
