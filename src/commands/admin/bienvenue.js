import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { runGreetingWizard } from '../../lib/greetings.js';

export default {
  data: new SlashCommandBuilder()
    .setName('bienvenue')
    .setDescription('Configurer le message de bienvenue (arrivées).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  execute(interaction) {
    return runGreetingWizard(interaction, 'welcome');
  },
};
