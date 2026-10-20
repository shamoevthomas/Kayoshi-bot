import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { parseDuration } from '../../lib/time.js';
import { startPoll, MIN_DURATION, MAX_DURATION } from '../../lib/wouldyourather.js';

// « Tu préfères… » : dilemme au hasard, vote avec deux boutons, résultats à la fin de la durée.
export default {
  data: new SlashCommandBuilder()
    .setName('tu-preferes')
    .setDescription('Lancer un « Tu préfères… » au hasard : vote A ou B, résultats à la fin du temps.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .addStringOption((o) =>
      o.setName('duree').setDescription('Durée du vote, ex : 30s, 15m, 1h, 2d (7 jours max)').setRequired(true).setMaxLength(10),
    ),

  async execute(interaction) {
    const input = interaction.options.getString('duree', true);
    const parsed = parseDuration(input);
    if (!parsed || parsed.permanent || parsed.ms < MIN_DURATION || parsed.ms > MAX_DURATION) {
      return interaction.reply({
        content: `❌ Durée invalide : \`${input}\`. Exemples : \`30s\`, \`15m\`, \`1h\`, \`2d\` (de 10 secondes à 7 jours).`,
        ephemeral: true,
      });
    }
    await startPoll(interaction, parsed.ms);
  },
};
