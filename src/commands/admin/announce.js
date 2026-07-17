import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Publier une annonce dans un salon précis.')
    .addChannelOption((o) =>
      o.setName('salon').setDescription('Salon cible').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true),
    )
    .addStringOption((o) => o.setName('message').setDescription('Contenu de l’annonce (\\n pour saut de ligne)').setRequired(true))
    .addStringOption((o) =>
      o
        .setName('mention')
        .setDescription('Mentionner qui ?')
        .addChoices(
          { name: '@everyone', value: 'everyone' },
          { name: '@here', value: 'here' },
          { name: 'Aucune', value: 'none' },
        ),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false),

  async execute(interaction) {
    const channel = interaction.options.getChannel('salon');
    const message = interaction.options.getString('message').replaceAll('\\n', '\n');
    const mention = interaction.options.getString('mention') ?? 'none';

    const prefix = mention === 'everyone' ? '@everyone\n' : mention === 'here' ? '@here\n' : '';
    const embed = new EmbedBuilder().setColor(0x5865f2).setDescription(message).setTimestamp();

    await channel.send({
      content: prefix || undefined,
      embeds: [embed],
      allowedMentions: { parse: mention === 'none' ? [] : [mention] },
    });
    await interaction.reply({ content: `✅ Annonce publiée dans ${channel}.`, ephemeral: true });
  },
};
