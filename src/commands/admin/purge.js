import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { sendLog, Colors } from '../../lib/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Supprimer un lot de messages dans ce salon.')
    .addIntegerOption((o) =>
      o.setName('nombre').setDescription('Combien de messages (1-100)').setRequired(true).setMinValue(1).setMaxValue(100),
    )
    .addUserOption((o) => o.setName('membre').setDescription('Ne supprimer que les messages de ce membre'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false),

  async execute(interaction) {
    const amount = interaction.options.getInteger('nombre');
    const member = interaction.options.getUser('membre');
    await interaction.deferReply({ ephemeral: true });

    let messages = await interaction.channel.messages.fetch({ limit: member ? 100 : amount });
    if (member) {
      messages = messages.filter((m) => m.author.id === member.id).first(amount);
    }
    // bulkDelete ignore les messages de +14 jours
    const deleted = await interaction.channel.bulkDelete(messages, true).catch(() => null);
    const count = deleted?.size ?? 0;

    await sendLog(
      interaction.guild,
      new EmbedBuilder()
        .setColor(Colors.delete)
        .setAuthor({ name: '🧹 Purge de messages' })
        .setDescription(`**${count}** message(s) supprimé(s) dans ${interaction.channel}${member ? ` (de ${member})` : ''}`)
        .addFields({ name: 'Par', value: `${interaction.user}`, inline: true })
        .setTimestamp(),
    );

    await interaction.editReply(
      `✅ ${count} message(s) supprimé(s).` +
        (count < amount ? '\nℹ️ Les messages de plus de 14 jours ne peuvent pas être supprimés en masse (limite Discord).' : ''),
    );
  },
};
