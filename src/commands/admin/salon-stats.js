import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { statPanel } from '../../lib/statchannels.js';

// Salons de statistiques : /salon-stats ouvre un panneau pour choisir les chiffres affichés (voir lib/statchannels.js).
export default {
  data: new SlashCommandBuilder()
    .setName('salon-stats')
    .setDescription('Salons dont le nom affiche les stats du serveur (membres, en ligne, en vocal, boosts…).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false),

  async execute(interaction) {
    return interaction.reply({ ...statPanel(interaction.guild), ephemeral: true });
  },
};
