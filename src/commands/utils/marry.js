import { SlashCommandBuilder } from 'discord.js';
import { proposeMarriage } from '../../lib/family.js';

export default {
  data: new SlashCommandBuilder()
    .setName('marry')
    .setDescription('Demander un autre membre en mariage (virtuel).')
    .addUserOption((o) => o.setName('membre').setDescription('La personne à demander en mariage').setRequired(true))
    .setDMPermission(false),

  async execute(interaction) {
    const target = interaction.options.getMember('membre');
    if (!target) return interaction.reply({ content: '❌ Membre introuvable sur le serveur.', ephemeral: true });
    await proposeMarriage(interaction, target);
  },
};
