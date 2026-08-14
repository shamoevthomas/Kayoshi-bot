import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ComponentType,
} from 'discord.js';
import { setLinkConfig } from '../../lib/store.js';

export default {
  data: new SlashCommandBuilder()
    .setName('configlien')
    .setDescription('Configurer le blocage des liens (par salon et par rôle).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    const filter = (i) => i.user.id === interaction.user.id;
    const config = { allowedChannelIds: [], roleIds: [], allowedRoleIds: [], logChannelId: null };

    const channelRow = new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId('cfgl_chans')
        .setPlaceholder('Salons où les liens sont autorisés')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(1)
        .setMaxValues(25),
    );

    const msg = await interaction.reply({
      content: '**1/4 — Salons autorisés**\nDans quels salons les liens doivent-ils être autorisé ?',
      components: [channelRow],
      ephemeral: true,
      fetchReply: true,
    });

    try {
      const chanSel = await msg.awaitMessageComponent({ componentType: ComponentType.ChannelSelect, time: 300_000, filter });
      config.allowedChannelIds = chanSel.values;

      const roleRow = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId('cfgl_roles')
          .setPlaceholder('Rôles interdits de poster des liens')
          .setMinValues(1)
          .setMaxValues(25),
      );
      await chanSel.update({
        content: `✅ ${config.allowedChannelIds.length} salon(s) autorisé(s)\n\n**2/4 — Rôles interdits**\nQuels rôles n’ont PAS le droit de poster des liens (partout sauf dans les salons autorisés) ?`,
        components: [roleRow],
      });

      const roleSel = await msg.awaitMessageComponent({ componentType: ComponentType.RoleSelect, time: 300_000, filter });
      config.roleIds = roleSel.values;

      // 3/3 — rôles autorisés (exceptions), facultatif
      const allowRow = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId('cfgl_allow')
          .setPlaceholder('Rôles autorisés à poster des liens (exceptions)')
          .setMinValues(0)
          .setMaxValues(25),
      );
      const doneRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('cfgl_done').setLabel('Suivant').setStyle(ButtonStyle.Primary),
      );

      const step3Text = () =>
        `✅ ${config.roleIds.length} rôle(s) bloqué(s)\n\n` +
        `**3/4 — Rôles autorisés (exceptions)** *(facultatif)*\n` +
        `Ces rôles pourront **toujours** poster des liens, même s’ils ont un rôle bloqué.\n` +
        (config.allowedRoleIds.length ? `Sélectionnés : ${config.allowedRoleIds.map((r) => `<@&${r}>`).join(' ')}\n` : '') +
        `Clique sur **Suivant** pour continuer (avec ou sans exception).`;

      await roleSel.update({ content: step3Text(), components: [allowRow, doneRow] });

      // Boucle : on accepte les changements d'exceptions jusqu'au clic sur "Suivant".
      for (;;) {
        const sel = await msg.awaitMessageComponent({ time: 300_000, filter });
        if (sel.customId === 'cfgl_allow') {
          config.allowedRoleIds = sel.values;
          await sel.update({ content: step3Text(), components: [allowRow, doneRow] });
        } else {
          break;
        }
      }

      // ===== 4/4 — Salon des liens détectés =====
      const logRow = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId('cfgl_logchan')
          .setPlaceholder('Salon où enregistrer les liens détectés')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setMinValues(1)
          .setMaxValues(1),
      );
      await msg.edit({
        content:
          `✅ Exceptions : ${config.allowedRoleIds.length ? config.allowedRoleIds.map((r) => `<@&${r}>`).join(' ') : '_aucune_'}\n\n` +
          `**4/4 — Salon des liens détectés**\nOù veux-tu que j’enregistre chaque lien bloqué ?`,
        components: [logRow],
      });

      const logSel = await msg.awaitMessageComponent({ componentType: ComponentType.ChannelSelect, time: 300_000, filter });
      config.logChannelId = logSel.values[0];

      setLinkConfig(interaction.guild.id, config);
      await logSel.update({
        content:
          `✅ **Filtre anti-liens configuré !**\n` +
          `• Salons autorisés : ${config.allowedChannelIds.map((c) => `<#${c}>`).join(' ')}\n` +
          `• Rôles bloqués : ${config.roleIds.map((r) => `<@&${r}>`).join(' ')}\n` +
          `• Rôles autorisés (exceptions) : ${config.allowedRoleIds.length ? config.allowedRoleIds.map((r) => `<@&${r}>`).join(' ') : '_aucun_'}\n` +
          `• Salon des liens détectés : <#${config.logChannelId}>\n\n` +
          `🔗 Liens **toujours autorisés** : YouTube, TikTok, Instagram, Snapchat (et les GIF).\n` +
          `Tout autre lien posté par un rôle bloqué est supprimé **partout sauf** dans les salons autorisés — sauf exception — et enregistré dans <#${config.logChannelId}>.`,
        components: [],
      });
    } catch (err) {
      console.error(err);
      return interaction.editReply({ content: '⏱️ Configuration annulée (délai dépassé). Relance `/configlien`.', components: [] }).catch(() => {});
    }
  },
};
