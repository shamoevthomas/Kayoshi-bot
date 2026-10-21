import { SlashCommandBuilder } from 'discord.js';
import { proposeAdoption } from '../../lib/family.js';

export default {
  data: new SlashCommandBuilder()
    .setName('adopt')
    .setDescription('Adopter un autre membre dans ta famille (virtuel).')
    .addUserOption((o) => o.setName('membre').setDescription('La personne à adopter').setRequired(true))
    .setDMPermission(false),

  async execute(interaction) {
    const target = interaction.options.getMember('membre');
    if (!target) return interaction.reply({ content: '❌ Membre introuvable sur le serveur.', ephemeral: true });
    await proposeAdoption(interaction, target);
  },
};
