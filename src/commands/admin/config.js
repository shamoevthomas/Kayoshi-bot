import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { configHome } from '../../lib/configpanel.js';

// /config : panneau de configuration (un bouton par système), voir lib/configpanel.js.
// Les anciennes commandes de réglage (dossier commands/config) y sont lancées par boutons et formulaires.
export default {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Panneau de configuration : activer et régler les systèmes du bot (accueil, boost, sécurité…).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    return interaction.reply({ ...configHome(interaction.guild), ephemeral: true });
  },
};
