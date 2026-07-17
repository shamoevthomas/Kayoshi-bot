import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { sendLog, Colors } from '../../lib/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Déverrouiller ce salon (rend l’écriture à @everyone).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false),

  async execute(interaction) {
    await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
      SendMessages: null,
    });

    await sendLog(
      interaction.guild,
      new EmbedBuilder()
        .setColor(Colors.join)
        .setAuthor({ name: '🔓 Salon déverrouillé' })
        .setDescription(`${interaction.channel}`)
        .addFields({ name: 'Par', value: `${interaction.user}`, inline: true })
        .setTimestamp(),
    );

    await interaction.reply('🔓 Salon déverrouillé.');
  },
};
