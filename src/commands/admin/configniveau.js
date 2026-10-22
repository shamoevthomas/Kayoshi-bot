import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { setLevelUpConfig } from '../../lib/store.js';
import { formatLevelUp } from '../../lib/levels.js';

export default {
  data: new SlashCommandBuilder()
    .setName('configniveau')
    .setDescription('Configurer le message affiché quand un membre monte de niveau.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addStringOption((o) =>
      o
        .setName('message')
        .setDescription('Texte du message. Variables : {user} {username} {level} {server}')
        .setRequired(true)
        .setMaxLength(1500),
    )
    .addChannelOption((o) =>
      o
        .setName('salon')
        .setDescription('Salon d’annonce (par défaut : le salon où le membre monte de niveau)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false),
    ),

  async execute(interaction) {
    const message = interaction.options.getString('message');
    const salon = interaction.options.getChannel('salon');

    setLevelUpConfig(interaction.guild.id, { message, channelId: salon?.id ?? null });

    const preview = formatLevelUp(message, {
      user: interaction.user,
      level: 5,
      guild: interaction.guild,
    });

    await interaction.reply({
      content:
        `✅ **Message de niveau enregistré.**\n` +
        `• Salon : ${salon ? `${salon}` : '_là où le membre monte de niveau_'}\n` +
        `• Variables : \`{user}\` \`{username}\` \`{level}\` \`{server}\`\n\n` +
        `**Aperçu (niveau 5) :**\n${preview}`,
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
  },
};
