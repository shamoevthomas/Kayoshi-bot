import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { sendLog, Colors } from '../../lib/logger.js';
import { lockRole } from '../../lib/roles.js';

export default {
  data: new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Déverrouiller ce salon (rend l’écriture au rôle des membres).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false),

  async execute(interaction) {
    const role = lockRole(interaction.guild);
    await interaction.channel.permissionOverwrites.edit(role, {
      SendMessages: null,
    });

    await sendLog(
      interaction.guild,
      new EmbedBuilder()
        .setColor(Colors.join)
        .setAuthor({ name: '🔓 Salon déverrouillé' })
        .setDescription(`${interaction.channel} (pour ${role})`)
        .addFields({ name: 'Par', value: `${interaction.user}`, inline: true })
        .setTimestamp(),
    );

    await interaction.reply('🔓 Salon déverrouillé.');
  },
};
