import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getInviteLeaderboard } from '../../lib/store.js';
import { Colors } from '../../lib/logger.js';

const MEDALS = ['🥇', '🥈', '🥉'];

export default {
  data: new SlashCommandBuilder()
    .setName('inviteleaderboard')
    .setDescription('Classement des meilleurs parrains du serveur.')
    .setDMPermission(false)
    .addIntegerOption((opt) =>
      opt
        .setName('limite')
        .setDescription('Nombre de membres à afficher (par défaut 10)')
        .setMinValue(1)
        .setMaxValue(25)
        .setRequired(false),
    ),

  async execute(interaction) {
    const limit = interaction.options.getInteger('limite') ?? 10;
    const rows = getInviteLeaderboard(interaction.guild.id).slice(0, limit);

    if (!rows.length) {
      return interaction.reply({
        content: 'Aucune invitation enregistrée pour le moment. Le classement se remplira au fil des arrivées.',
        ephemeral: true,
      });
    }

    const lines = rows.map((r, i) => {
      const rank = MEDALS[i] ?? `**${i + 1}.**`;
      const detail = r.left ? ` *(${r.real} réelles, ${r.left} parties${r.bonus ? `, ${r.bonus} bonus` : ''})*` : '';
      return `${rank} <@${r.userId}> — **${r.total}** invitation(s)${detail}`;
    });

    const embed = new EmbedBuilder()
      .setColor(Colors.role)
      .setAuthor({ name: `Classement des invitations — ${interaction.guild.name}`, iconURL: interaction.guild.iconURL() ?? undefined })
      .setDescription(lines.join('\n'))
      .setFooter({ text: `Top ${rows.length}` })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },
};
