import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { sportModal } from '../../lib/sport.js';

// /config → Sport : salons des résultats et matchs à venir (football, UFC). Voir lib/sport.js.
export default {
  data: new SlashCommandBuilder()
    .setName('sport')
    .setDescription('Résultats et matchs à venir : le football dans un salon, l’UFC dans un autre.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    return interaction.showModal(sportModal(interaction.guild.id));
  },
};
