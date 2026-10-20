import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { sendLog, Colors } from '../../lib/logger.js';
import { lockRole } from '../../lib/roles.js';

export default {
  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Verrouiller ce salon (empêche le rôle des membres d’écrire).')
    .addStringOption((o) => o.setName('raison').setDescription('Raison du verrouillage'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false),

  async execute(interaction) {
    const reason = interaction.options.getString('raison') ?? 'Aucune raison précisée';
    const role = lockRole(interaction.guild);
    await interaction.channel.permissionOverwrites.edit(role, {
      SendMessages: false,
    });

    await sendLog(
      interaction.guild,
      new EmbedBuilder()
        .setColor(Colors.delete)
        .setAuthor({ name: '🔒 Salon verrouillé' })
        .setDescription(`${interaction.channel} (pour ${role})`)
        .addFields(
          { name: 'Raison', value: reason },
          { name: 'Par', value: `${interaction.user}`, inline: true },
        )
        .setTimestamp(),
    );

    await interaction.reply({
      content: `🔒 Salon verrouillé. ${reason !== 'Aucune raison précisée' ? `\nRaison : ${reason}` : ''}`,
      allowedMentions: { parse: [] },
    });
  },
};
