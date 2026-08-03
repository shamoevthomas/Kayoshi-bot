import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getInviteStats, getInviteTotal, getInviteRanks } from '../../lib/store.js';
import { Colors } from '../../lib/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('invitations')
    .setDescription("Suivi des invitations d'un membre (total, détail, palier).")
    .setDMPermission(false)
    .addUserOption((opt) =>
      opt.setName('membre').setDescription('Le membre à consulter (toi par défaut)').setRequired(false),
    ),

  async execute(interaction) {
    const target = interaction.options.getUser('membre') ?? interaction.user;
    const guildId = interaction.guild.id;
    const stats = getInviteStats(guildId, target.id);
    const total = getInviteTotal(guildId, target.id);
    const ranks = [...getInviteRanks(guildId)].sort((a, b) => a.count - b.count);

    const current = [...ranks].reverse().find((r) => total >= r.count) ?? null;
    const next = ranks.find((r) => r.count > total) ?? null;

    const embed = new EmbedBuilder()
      .setColor(Colors.role)
      .setAuthor({ name: `Invitations de ${target.username}`, iconURL: target.displayAvatarURL() })
      .setDescription(`**${total}** invitation(s) au total.`)
      .addFields({
        name: 'Détail',
        value:
          `✅ Réelles : **${stats.real}**\n` +
          `📉 Parties : **${stats.left}**` +
          (stats.bonus ? `\n🎁 Bonus : **${stats.bonus}**` : ''),
        inline: false,
      })
      .setTimestamp();

    if (current) {
      embed.addFields({ name: 'Palier actuel', value: `<@&${current.roleId}> (${current.count}+)`, inline: true });
    } else if (ranks.length) {
      embed.addFields({ name: 'Palier actuel', value: 'Aucun pour le moment', inline: true });
    }

    if (next) {
      embed.addFields({
        name: 'Prochain palier',
        value: `<@&${next.roleId}> — encore **${next.count - total}** invitation(s)`,
        inline: true,
      });
    } else if (ranks.length) {
      embed.addFields({ name: 'Prochain palier', value: '🏆 Palier maximum atteint !', inline: true });
    }

    return interaction.reply({ embeds: [embed] });
  },
};
