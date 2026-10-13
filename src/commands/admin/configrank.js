import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { getRankConfig, setRankConfig } from '../../lib/store.js';
import { RANK_TEMPLATE_HELP, DEFAULT_RANK_MESSAGE } from '../../lib/rank.js';

const MAX_LEN = 2000;

// Salon et message des annonces de /rank. Le message est saisi dans un formulaire
// (pour pouvoir faire des retours à la ligne).
export default {
  data: new SlashCommandBuilder()
    .setName('configrank')
    .setDescription('Choisir le salon et le message des annonces de /rank.')
    .addChannelOption((o) =>
      o
        .setName('salon')
        .setDescription('Le salon où les rank sont annoncés')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    const channel = interaction.options.getChannel('salon');
    const current = getRankConfig(interaction.guild.id)?.message ?? DEFAULT_RANK_MESSAGE;

    const modalId = `configrank_${interaction.id}`;
    const input = new TextInputBuilder()
      .setCustomId('message')
      .setLabel('Message ([@] [role] [motif] [staff])')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(MAX_LEN)
      .setValue(current.slice(0, MAX_LEN));
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(modalId)
        .setTitle('Message des annonces de rank')
        .addComponents(new ActionRowBuilder().addComponents(input)),
    );

    let sub;
    try {
      sub = await interaction.awaitModalSubmit({
        time: 600_000,
        filter: (i) => i.customId === modalId && i.user.id === interaction.user.id,
      });
    } catch {
      return; // formulaire fermé ou délai dépassé
    }

    const message = sub.fields.getTextInputValue('message').trim();
    if (!message) return sub.reply({ content: '❌ Le message ne peut pas être vide.', ephemeral: true });

    setRankConfig(interaction.guild.id, { channelId: channel.id, message });
    await sub.reply({
      content: `✅ Les annonces de \`/rank\` seront postées dans ${channel} avec ce message :\n>>> ${message}\n\n-# ${RANK_TEMPLATE_HELP}`,
      allowedMentions: { parse: [] },
      ephemeral: true,
    });
  },
};
