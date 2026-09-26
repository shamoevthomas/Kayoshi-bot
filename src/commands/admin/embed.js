import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { builderPayload, defaultEmbed } from '../../lib/embedbuilder.js';

export default {
  data: new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Créer un embed (aperçu modifiable) à envoyer ou à utiliser en message de bienvenue / départ.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false),

  async execute(interaction) {
    await interaction.reply({ ...builderPayload(defaultEmbed()), ephemeral: true });
  },
};
