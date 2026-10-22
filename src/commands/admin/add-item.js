import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { addShopItem } from '../../lib/store.js';
import { formatMoney } from '../../lib/shop.js';

export default {
  data: new SlashCommandBuilder()
    .setName('add-item')
    .setDescription('Ajouter un objet à la boutique.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addStringOption((o) => o.setName('nom').setDescription('Nom de l’objet').setRequired(true).setMaxLength(80))
    .addIntegerOption((o) => o.setName('prix').setDescription('Prix en argent').setRequired(true).setMinValue(0))
    .addStringOption((o) => o.setName('description').setDescription('Description affichée dans la boutique').setMaxLength(300)),

  async execute(interaction) {
    const name = interaction.options.getString('nom', true).trim();
    const price = interaction.options.getInteger('prix', true);
    const description = interaction.options.getString('description')?.trim() || null;
    const item = addShopItem(interaction.guild.id, { name, price, description });
    await interaction.reply({
      content: `✅ Objet **${item.name}** ajouté à la boutique pour 💰 **${formatMoney(price)}**.`,
      ephemeral: true,
    });
  },
};
