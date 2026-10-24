import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getLevelLeaderboard } from '../../lib/store.js';
import { levelFromXp, LEVEL_COLOR } from '../../lib/levels.js';

const MEDALS = ['🥇', '🥈', '🥉'];

export default {
  data: new SlashCommandBuilder()
    .setName('niveaux')
    .setDescription('Classement des membres par niveau / XP.')
    .setDMPermission(false),

  async execute(interaction) {
    const top = getLevelLeaderboard(interaction.guild.id, 15);
    const lines = top.length
      ? top
          .map((r, i) => {
            const rank = MEDALS[i] ?? `**${i + 1}.**`;
            return `${rank} <@${r.userId}> — niveau **${levelFromXp(r.xp)}** · **${r.xp}** XP`;
          })
          .join('\n')
      : '_Personne n’a encore d’XP._';

    const embed = new EmbedBuilder()
      .setColor(LEVEL_COLOR)
      .setTitle('🏆 Classement des niveaux')
      .setDescription(lines)
      .setFooter({ text: `${interaction.guild.name}` })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },
};
