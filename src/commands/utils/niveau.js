import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getXp, getLevelRank } from '../../lib/store.js';
import { levelInfo } from '../../lib/levels.js';
import { Colors } from '../../lib/logger.js';

function progressBar(into, span, size = 14) {
  const ratio = span > 0 ? Math.min(1, into / span) : 0;
  const filled = Math.round(ratio * size);
  return '▰'.repeat(filled) + '▱'.repeat(size - filled);
}

export default {
  data: new SlashCommandBuilder()
    .setName('niveau')
    .setDescription('Voir ton niveau (ou celui d’un membre).')
    .setDMPermission(false)
    .addUserOption((o) => o.setName('membre').setDescription('Le membre à consulter').setRequired(false)),

  async execute(interaction) {
    const user = interaction.options.getUser('membre') ?? interaction.user;
    if (user.bot) {
      return interaction.reply({ content: '❌ Les bots n’ont pas de niveau.', ephemeral: true });
    }

    const xp = getXp(interaction.guild.id, user.id);
    const info = levelInfo(xp);
    const rank = getLevelRank(interaction.guild.id, user.id);

    const embed = new EmbedBuilder()
      .setColor(Colors.role)
      .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
      .setTitle(`🎚️ Niveau ${info.level}`)
      .setDescription(
        `${progressBar(info.into, info.span)}\n` +
          `**${info.into} / ${info.span}** XP dans ce niveau · encore **${info.toNext}** XP pour le niveau ${info.level + 1}`,
      )
      .addFields(
        { name: 'XP totale', value: `**${xp}**`, inline: true },
        { name: 'Classement', value: rank ? `#**${rank}**` : '—', inline: true },
      );

    return interaction.reply({ embeds: [embed] });
  },
};
