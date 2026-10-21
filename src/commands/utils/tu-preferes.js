import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { parseDuration } from '../../lib/time.js';
import { startPoll, MIN_DURATION, MAX_DURATION } from '../../lib/wouldyourather.js';

// « Tu préfères… » : dilemme au hasard (ou tes propres options), vote A / B, résultats à la fin.
export default {
  data: new SlashCommandBuilder()
    .setName('tu-preferes')
    .setDescription('Lancer un « Tu préfères… » : vote A ou B, résultats à la fin du temps.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .addStringOption((o) =>
      o.setName('duree').setDescription('Durée du vote, ex : 30s, 15m, 1h, 2d (7 jours max)').setRequired(true).setMaxLength(10),
    )
    .addStringOption((o) => o.setName('option_a').setDescription('(Facultatif) Option A — vide = au hasard').setMaxLength(200))
    .addStringOption((o) => o.setName('option_b').setDescription('(Facultatif) Option B — vide = au hasard').setMaxLength(200))
    .addRoleOption((o) => o.setName('role').setDescription('(Facultatif) Rôle à mentionner au-dessus du vote')),

  async execute(interaction) {
    const input = interaction.options.getString('duree', true);
    const parsed = parseDuration(input);
    if (!parsed || parsed.permanent || parsed.ms < MIN_DURATION || parsed.ms > MAX_DURATION) {
      return interaction.reply({
        content: `❌ Durée invalide : \`${input}\`. Exemples : \`30s\`, \`15m\`, \`1h\`, \`2d\` (de 10 secondes à 7 jours).`,
        ephemeral: true,
      });
    }

    const optionA = interaction.options.getString('option_a')?.trim() || null;
    const optionB = interaction.options.getString('option_b')?.trim() || null;
    // Une seule option donnée : l'autre serait tirée au hasard, le duo n'aurait pas de sens.
    if (Boolean(optionA) !== Boolean(optionB)) {
      return interaction.reply({
        content: '❌ Donne **les deux** options (A et B), ou aucune pour un dilemme au hasard.',
        ephemeral: true,
      });
    }

    // Mention du rôle : pas via le bot ce que le membre ne pourrait pas faire lui-même.
    const role = interaction.options.getRole('role');
    if (role) {
      if (role.id === interaction.guild.id) {
        return interaction.reply({ content: '❌ Choisis un rôle précis : @everyone n’est pas possible ici.', ephemeral: true });
      }
      if (!role.mentionable && !interaction.memberPermissions.has(PermissionFlagsBits.MentionEveryone)) {
        return interaction.reply({
          content: `❌ Le rôle **@${role.name}** n’est pas mentionnable et tu n’as pas la permission de le mentionner.`,
          ephemeral: true,
        });
      }
    }

    await startPoll(interaction, parsed.ms, { optionA, optionB, roleId: role?.id ?? null });
  },
};
