import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { securityHome } from '../../lib/security.js';

// /config → Sécurité : panneau des protections du serveur (lib/security.js).
export default {
  data: new SlashCommandBuilder()
    .setName('securite')
    .setDescription('Protections : anti-spam, anti-mention, anti-invite, anti-nuke, anti-bot… (admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    return interaction.reply({ ...securityHome(interaction.guild), ephemeral: true });
  },
};
