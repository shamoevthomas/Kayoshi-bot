import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Régler le mode lent du salon (0 pour désactiver).')
    .addIntegerOption((o) =>
      o.setName('secondes').setDescription('Délai entre messages (0-21600)').setRequired(true).setMinValue(0).setMaxValue(21600),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false),

  async execute(interaction) {
    const seconds = interaction.options.getInteger('secondes');
    await interaction.channel.setRateLimitPerUser(seconds, `Slowmode par ${interaction.user.tag}`);
    await interaction.reply({
      content: seconds === 0 ? '✅ Mode lent désactivé.' : `✅ Mode lent réglé à **${seconds}s** par message.`,
      ephemeral: true,
    });
  },
};
