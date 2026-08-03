import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getInviteCount, getInviteRanks } from '../../lib/store.js';
import { Colors } from '../../lib/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('invitations')
    .setDescription("Voir le nombre d'invitations d'un membre et son prochain palier.")
    .setDMPermission(false)
    .addUserOption((opt) =>
      opt.setName('membre').setDescription('Le membre à consulter (toi par défaut)').setRequired(false),
    ),

  async execute(interaction) {
    const target = interaction.options.getUser('membre') ?? interaction.user;
    const total = getInviteCount(interaction.guild.id, target.id);
    const ranks = [...getInviteRanks(interaction.guild.id)].sort((a, b) => a.count - b.count);

    const current = [...ranks].reverse().find((r) => total >= r.count) ?? null;
    const next = ranks.find((r) => r.count > total) ?? null;

    const embed = new EmbedBuilder()
      .setColor(Colors.role)
      .setAuthor({ name: `Invitations de ${target.username}`, iconURL: target.displayAvatarURL() })
      .setDescription(`**${total}** membre(s) invité(s) au total.`)
      .setTimestamp();

    if (current) {
      embed.addFields({ name: 'Palier actuel', value: `<@&${current.roleId}> (${current.count}+)`, inline: true });
    } else if (ranks.length) {
      embed.addFields({ name: 'Palier actuel', value: 'Aucun pour le moment', inline: true });
    }

    if (next) {
      const remaining = next.count - total;
      embed.addFields({
        name: 'Prochain palier',
        value: `<@&${next.roleId}> — encore **${remaining}** invitation(s)`,
        inline: true,
      });
    } else if (ranks.length) {
      embed.addFields({ name: 'Prochain palier', value: '🏆 Palier maximum atteint !', inline: true });
    }

    return interaction.reply({ embeds: [embed] });
  },
};
