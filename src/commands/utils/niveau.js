import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getXp, getLevelRank, getXpEvent, getXpBoost } from '../../lib/store.js';
import { levelInfo, LEVEL_COLOR } from '../../lib/levels.js';

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
      .setColor(LEVEL_COLOR)
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

    // Bonus d'XP en cours : événement du serveur et booster acheté dans la boutique.
    const now = Date.now();
    const bonuses = [];
    const event = getXpEvent(interaction.guild.id);
    if (event?.endsAt > now) bonuses.push(`⚡ Événement ×${event.multiplier} (fin <t:${Math.floor(event.endsAt / 1000)}:R>)`);
    const boost = getXpBoost(interaction.guild.id, user.id);
    if (boost?.endsAt > now) bonuses.push(`🚀 Booster ×${boost.multiplier} (fin <t:${Math.floor(boost.endsAt / 1000)}:R>)`);
    if (bonuses.length) embed.addFields({ name: 'Bonus d’XP en cours', value: bonuses.join('\n') });

    return interaction.reply({ embeds: [embed] });
  },
};
