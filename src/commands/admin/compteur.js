import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { counterPanel } from '../../lib/counting.js';

// Salon de comptage : /compteur ouvre un panneau avec les boutons Activer (choix du salon), Désactiver
// et Voir (voir lib/counting.js).
export default {
  data: new SlashCommandBuilder()
    .setName('compteur')
    .setDescription('Salon de comptage : les membres comptent 1, 2, 3… à tour de rôle, sans fin.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    return interaction.reply({ ...counterPanel(interaction.guild.id), ephemeral: true });
  },
};
