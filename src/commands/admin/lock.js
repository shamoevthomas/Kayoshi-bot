import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { sendLog, Colors } from '../../lib/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Verrouiller ce salon (empêche @everyone d’écrire).')
    .addStringOption((o) => o.setName('raison').setDescription('Raison du verrouillage'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false),

  async execute(interaction) {
    const reason = interaction.options.getString('raison') ?? 'Aucune raison précisée';
    await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
      SendMessages: false,
    });

    await sendLog(
      interaction.guild,
      new EmbedBuilder()
        .setColor(Colors.delete)
        .setAuthor({ name: '🔒 Salon verrouillé' })
        .setDescription(`${interaction.channel}`)
        .addFields(
          { name: 'Raison', value: reason },
          { name: 'Par', value: `${interaction.user}`, inline: true },
        )
        .setTimestamp(),
    );

    await interaction.reply(`🔒 Salon verrouillé. ${reason !== 'Aucune raison précisée' ? `\nRaison : ${reason}` : ''}`);
  },
};
