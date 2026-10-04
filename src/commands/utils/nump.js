import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getPartner } from '../../lib/store.js';
import { Colors } from '../../lib/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('nump')
    .setDescription('Nombre de partenariats effectués par un membre.')
    .setDMPermission(false)
    .addUserOption((opt) => opt.setName('membre').setDescription('Le membre qui fait des partenariats').setRequired(true)),

  async execute(interaction) {
    const target = interaction.options.getUser('membre');
    const { total = 0, byUser = {} } = getPartner(interaction.guild.id);
    const count = byUser[target.id] ?? 0;
    // Rang = 1 + nombre de membres qui en ont fait strictement plus.
    const counts = Object.values(byUser).filter((n) => n > 0);
    const rank = 1 + counts.filter((n) => n > count).length;

    const embed = new EmbedBuilder()
      .setColor(Colors.role)
      .setAuthor({ name: `Partenariats de ${target.username}`, iconURL: target.displayAvatarURL() })
      .setDescription(`🤝 **${count}** partenariat(s) effectué(s).`)
      .addFields(
        { name: 'Rang', value: count ? `**#${rank}** sur ${counts.length}` : '—', inline: true },
        { name: 'Total du serveur', value: `**${total}** partenariat(s)`, inline: true },
      )
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },
};
