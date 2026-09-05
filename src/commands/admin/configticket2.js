import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { runTicketWizard } from './configticket.js';

// Deuxième système de tickets, totalement indépendant du premier
// (panneau, staff, archives et catégories séparés).
export default {
  data: new SlashCommandBuilder()
    .setName('configticket2')
    .setDescription('Configurer un 2ᵉ système de tickets (indépendant du 1er).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  execute(interaction) {
    return runTicketWizard(interaction, 2);
  },
};
