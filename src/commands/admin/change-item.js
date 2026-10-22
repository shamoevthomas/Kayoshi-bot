import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { getShopItems, getShopItem, updateShopItem } from '../../lib/store.js';
import { formatMoney } from '../../lib/shop.js';

const RESET = 'aucune';

export default {
  data: new SlashCommandBuilder()
    .setName('change-item')
    .setDescription('Modifier le nom, le prix ou la description d’un objet de la boutique.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addStringOption((o) => o.setName('objet').setDescription('L’objet à modifier').setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName('nom').setDescription('Nouveau nom').setMaxLength(80))
    .addIntegerOption((o) => o.setName('prix').setDescription('Nouveau prix').setMinValue(0))
    .addStringOption((o) => o.setName('description').setDescription(`Nouvelle description (« ${RESET} » pour la retirer)`).setMaxLength(300)),

  async autocomplete(interaction) {
    const query = interaction.options.getFocused().toLowerCase();
    await interaction.respond(
      Object.entries(getShopItems(interaction.guild.id))
        .filter(([, it]) => it.name.toLowerCase().includes(query))
        .slice(0, 25)
        .map(([id, it]) => ({ name: `${it.name} (💰 ${formatMoney(it.price)})`.slice(0, 100), value: id })),
    );
  },

  async execute(interaction) {
    const itemId = interaction.options.getString('objet', true);
    const item = getShopItem(interaction.guild.id, itemId);
    if (!item) return interaction.reply({ content: '❌ Objet introuvable (choisis-le dans la liste).', ephemeral: true });

    const patch = {};
    const nom = interaction.options.getString('nom')?.trim();
    const prix = interaction.options.getInteger('prix');
    const description = interaction.options.getString('description')?.trim();

    if (nom) patch.name = nom;
    if (prix != null) patch.price = prix;
    if (description) patch.description = description.toLowerCase() === RESET ? null : description;

    if (!Object.keys(patch).length) {
      return interaction.reply({
        content: `ℹ️ **${item.name}** — 💰 ${formatMoney(item.price)}\n${item.description ?? '_Aucune description._'}\n-# Ajoute une option (nom, prix, description) pour le modifier.`,
        ephemeral: true,
      });
    }

    const updated = updateShopItem(interaction.guild.id, itemId, patch);
    const changes = [];
    if (patch.name) changes.push(`• Nom : **${item.name}** → **${updated.name}**`);
    if (patch.price != null) changes.push(`• Prix : 💰 ${formatMoney(item.price)} → 💰 ${formatMoney(updated.price)}`);
    if ('description' in patch) changes.push(`• Description ${updated.description ? 'mise à jour' : 'retirée'}`);

    return interaction.reply({ content: `✅ Objet **${updated.name}** modifié :\n${changes.join('\n')}`, ephemeral: true });
  },
};
