import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { getShopItems, removeShopItem } from '../../lib/store.js';
import { formatMoney } from '../../lib/shop.js';

export default {
  data: new SlashCommandBuilder()
    .setName('remove-item')
    .setDescription('Retirer un objet de la boutique.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addStringOption((o) => o.setName('objet').setDescription('L’objet à retirer').setRequired(true).setAutocomplete(true)),

  async autocomplete(interaction) {
    const query = interaction.options.getFocused().toLowerCase();
    const items = Object.entries(getShopItems(interaction.guild.id))
      .filter(([, it]) => it.name.toLowerCase().includes(query))
      .slice(0, 25)
      .map(([id, it]) => ({ name: `${it.name} (💰 ${formatMoney(it.price)})`.slice(0, 100), value: id }));
    await interaction.respond(items);
  },

  async execute(interaction) {
    const removed = removeShopItem(interaction.guild.id, interaction.options.getString('objet', true));
    if (!removed) return interaction.reply({ content: '❌ Objet introuvable (choisis-le dans la liste).', ephemeral: true });
    await interaction.reply({ content: `🗑️ Objet **${removed.name}** retiré de la boutique.`, ephemeral: true });
  },
};
