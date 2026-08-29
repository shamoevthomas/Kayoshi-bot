import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelType,
  ComponentType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { setBoostConfig } from '../../lib/store.js';
import { BOOST_TEMPLATE_HELP } from '../../lib/boost.js';

export default {
  data: new SlashCommandBuilder()
    .setName('configboost')
    .setDescription('Configurer le message envoyé quand quelqu’un boost le serveur.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    const filter = (i) => i.user.id === interaction.user.id;
    const config = { channelId: null, message: '', mentionType: 'none', roleId: null };

    // ===== 1/3 — Salon =====
    const chanRow = new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId('cfgb_chan')
        .setPlaceholder('Salon où envoyer le message de boost')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(1)
        .setMaxValues(1),
    );
    const msg = await interaction.reply({
      content: '**1/3 — Salon**\nDans quel salon envoyer le message de boost ?',
      components: [chanRow],
      ephemeral: true,
      fetchReply: true,
    });

    try {
      const chanSel = await msg.awaitMessageComponent({ componentType: ComponentType.ChannelSelect, time: 600_000, filter });
      config.channelId = chanSel.values[0];

      // ===== 2/3 — Message (modal) =====
      const writeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('cfgb_write').setLabel('Rédiger le message').setStyle(ButtonStyle.Primary).setEmoji('✏️'),
      );
      await chanSel.update({
        content: `✅ Salon : <#${config.channelId}>\n\n**2/3 — Message**\nQuel message veux-tu envoyer quand quelqu’un boost le serveur ?\n${BOOST_TEMPLATE_HELP}`,
        components: [writeRow],
      });

      const wb = await msg.awaitMessageComponent({ componentType: ComponentType.Button, time: 600_000, filter });
      const modal = new ModalBuilder()
        .setCustomId('cfgb_modal')
        .setTitle('Message de boost')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('message')
              .setLabel('Message')
              .setPlaceholder('Merci [membre] pour le boost ! On est maintenant [count] boosts 🚀')
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
              .setMaxLength(1500),
          ),
        );
      await wb.showModal(modal);
      const sub = await wb.awaitModalSubmit({ time: 600_000, filter: (i) => i.customId === 'cfgb_modal' && i.user.id === interaction.user.id });
      config.message = sub.fields.getTextInputValue('message');

      // ===== 3/3 — Mention =====
      const mentionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('cfgb_mrole').setLabel('Mentionner un rôle').setStyle(ButtonStyle.Primary).setEmoji('🔔'),
        new ButtonBuilder().setCustomId('cfgb_meveryone').setLabel('@everyone').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('cfgb_mhere').setLabel('@here').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('cfgb_mnone').setLabel('Aucune').setStyle(ButtonStyle.Secondary),
      );
      await sub.update({
        content: '✅ Message enregistré.\n\n**3/3 — Mention**\nVeux-tu mentionner un rôle en plus ? (@everyone et @here autorisés)',
        components: [mentionRow],
      });

      const mb = await msg.awaitMessageComponent({ componentType: ComponentType.Button, time: 600_000, filter });
      if (mb.customId === 'cfgb_meveryone') config.mentionType = 'everyone';
      else if (mb.customId === 'cfgb_mhere') config.mentionType = 'here';
      else if (mb.customId === 'cfgb_mnone') config.mentionType = 'none';
      else config.mentionType = 'role';

      if (config.mentionType === 'role') {
        await mb.update({
          content: 'Choisis le rôle à mentionner :',
          components: [
            new ActionRowBuilder().addComponents(
              new RoleSelectMenuBuilder().setCustomId('cfgb_role').setPlaceholder('Choisis un rôle').setMinValues(1).setMaxValues(1),
            ),
          ],
        });
        const rs = await msg.awaitMessageComponent({ componentType: ComponentType.RoleSelect, time: 600_000, filter });
        config.roleId = rs.values[0];
        setBoostConfig(interaction.guild.id, config);
        return rs.update({ content: summary(config), components: [] });
      }

      setBoostConfig(interaction.guild.id, config);
      return mb.update({ content: summary(config), components: [] });
    } catch (err) {
      console.error('[configboost] échec :', err);
      return interaction
        .editReply({ content: '⏱️ Configuration interrompue (délai ou erreur). Relance `/configboost`.', components: [] })
        .catch(() => {});
    }
  },
};

function summary(config) {
  const mention =
    config.mentionType === 'everyone'
      ? '@everyone'
      : config.mentionType === 'here'
        ? '@here'
        : config.mentionType === 'role'
          ? `<@&${config.roleId}>`
          : 'aucune';
  return (
    `✅ **Message de boost configuré !**\n` +
    `• Salon : <#${config.channelId}>\n` +
    `• Mention : ${mention}\n` +
    `• Message :\n> ${config.message.replaceAll('\n', '\n> ')}`
  );
}
