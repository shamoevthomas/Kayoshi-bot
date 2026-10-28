import { SlashCommandBuilder } from 'discord.js';
import { TABS, topMessage } from '../../lib/leaderboards.js';

// Tous les classements (niveaux, argent, poche, teams, messages, vocal, invitations, quiz) : voir lib/leaderboards.js.
export default {
  data: new SlashCommandBuilder()
    .setName('top')
    .setDescription('Classements : niveaux, argent, poche, teams, messages, vocal, invitations et quiz.')
    .addStringOption((o) =>
      o
        .setName('classement')
        .setDescription('Le classement à ouvrir (défaut : niveaux)')
        .addChoices(...Object.entries(TABS).map(([value, t]) => ({ name: t.label, value }))),
    )
    .setDMPermission(false),

  async execute(interaction) {
    await interaction.reply(topMessage(interaction.guild, interaction.options.getString('classement') ?? 'niveaux', interaction.user.id));
  },
};
