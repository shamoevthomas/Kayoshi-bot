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
import { RANK_TEMPLATE_HELP, DEFAULT_RANK_MESSAGE, DEFAULT_DERANK_MESSAGE } from '../../lib/rank.js';

const MAX_LEN = 2000;
const PREVIEW_LEN = 700; // aperçus dans la réponse (limite Discord : 2000 caractères)

// Salon et messages des annonces de /rank et /derank. Les messages sont saisis dans
// un formulaire (pour pouvoir faire des retours à la ligne).
export default {
  data: new SlashCommandBuilder()
    .setName('configrank')
    .setDescription('Choisir le salon et les messages des annonces de /rank et /derank.')
    .addChannelOption((o) =>
      o
        .setName('salon')
        .setDescription('Le salon où les rank et derank sont annoncés')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    const channel = interaction.options.getChannel('salon');
    const current = getRankConfig(interaction.guild.id);

    const modalId = `configrank_${interaction.id}`;
    const textInput = (id, label, value) =>
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(id)
          .setLabel(label)
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(MAX_LEN)
          .setValue(value.slice(0, MAX_LEN)),
      );
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(modalId)
        .setTitle('Messages des annonces rank / derank')
        .addComponents(
          textInput('message', 'Message /rank ([@] [role] [motif] [staff])', current?.message ?? DEFAULT_RANK_MESSAGE),
          textInput('derank', 'Message /derank ([@] [role] [motif] [staff])', current?.derankMessage ?? DEFAULT_DERANK_MESSAGE),
        ),
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
    const derankMessage = sub.fields.getTextInputValue('derank').trim();
    if (!message || !derankMessage) return sub.reply({ content: '❌ Les messages ne peuvent pas être vides.', ephemeral: true });

    setRankConfig(interaction.guild.id, { channelId: channel.id, message, derankMessage });
    const quote = (text) =>
      (text.length > PREVIEW_LEN ? `${text.slice(0, PREVIEW_LEN)}…` : text)
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n');
    await sub.reply({
      content:
        `✅ Les annonces de \`/rank\` et \`/derank\` seront postées dans ${channel}.\n` +
        `**/rank :**\n${quote(message)}\n**/derank :**\n${quote(derankMessage)}\n\n-# ${RANK_TEMPLATE_HELP}`,
      allowedMentions: { parse: [] },
      ephemeral: true,
    });
  },
};
