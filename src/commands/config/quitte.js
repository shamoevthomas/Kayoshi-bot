import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { runGreetingWizard } from '../../lib/greetings.js';

export default {
  data: new SlashCommandBuilder()
    .setName('quitte')
    .setDescription('Configurer le message de départ (membres qui quittent).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  execute(interaction) {
    return runGreetingWizard(interaction, 'leave');
  },
};
