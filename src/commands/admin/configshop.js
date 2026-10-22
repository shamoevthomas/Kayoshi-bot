import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { setShopConfig, getShopConfig } from '../../lib/store.js';
import { parseColor, shopPayload } from '../../lib/shop.js';

const RESET = 'defaut';

export default {
  data: new SlashCommandBuilder()
    .setName('configshop')
    .setDescription('Personnaliser le titre, la description et la couleur de la boutique.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addStringOption((o) => o.setName('titre').setDescription(`Titre de la boutique (« ${RESET} » pour revenir au défaut)`).setMaxLength(240))
    .addStringOption((o) => o.setName('description').setDescription(`Texte affiché en haut (« ${RESET} » pour retirer)`).setMaxLength(2000))
    .addStringOption((o) => o.setName('couleur').setDescription(`Couleur en hex, ex : #2ecc71 (« ${RESET} » = défaut)`)),

  async execute(interaction) {
    const guildId = interaction.guild.id;
    const read = (name) => interaction.options.getString(name)?.trim() || null;
    const isReset = (v) => v?.toLowerCase() === RESET;
    const patch = {};

    const titre = read('titre');
    if (isReset(titre)) patch.title = null;
    else if (titre) patch.title = titre;

    const description = read('description');
    if (isReset(description)) patch.description = null;
    else if (description) patch.description = description;

    const couleur = read('couleur');
    if (isReset(couleur)) patch.color = null;
    else if (couleur) {
      const hex = parseColor(couleur);
      if (hex == null) return interaction.reply({ content: `❌ \`${couleur}\` n’est pas une couleur hex (ex : \`#2ecc71\`).`, ephemeral: true });
      patch.color = hex;
    }

    if (!Object.keys(patch).length) {
      const cfg = getShopConfig(guildId);
      return interaction.reply({
        content:
          'ℹ️ Configuration actuelle de la boutique (ajoute une option pour la changer) :\n' +
          `• Titre : ${cfg.title ? `**${cfg.title}**` : '_défaut_'}\n` +
          `• Description : ${cfg.description ? cfg.description : '_aucune_'}\n` +
          `• Couleur : ${cfg.color != null ? `#${cfg.color.toString(16).padStart(6, '0')}` : '_défaut_'}`,
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
    }

    setShopConfig(guildId, patch);
    // Aperçu de la boutique telle qu'elle apparaîtra.
    return interaction.reply({ content: '✅ Boutique mise à jour. Aperçu :', ...shopPayload(interaction.guild, interaction.user.id, {}), ephemeral: true });
  },
};
