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
    const config = { channelIds: [], roleIds: [], allowedRoleIds: [] };

    const channelRow = new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId('cfgl_chans')
        .setPlaceholder('Salons où les liens sont bloqués')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(1)
        .setMaxValues(25),
    );

    const msg = await interaction.reply({
      content: '**1/2 — Salons concernés**\nDans quels salons les liens doivent-ils être bloqués ?',
      components: [channelRow],
      ephemeral: true,
      fetchReply: true,
    });

    try {
      const chanSel = await msg.awaitMessageComponent({ componentType: ComponentType.ChannelSelect, time: 300_000, filter });
      config.channelIds = chanSel.values;

      const roleRow = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId('cfgl_roles')
          .setPlaceholder('Rôles interdits de poster des liens')
          .setMinValues(1)
          .setMaxValues(25),
      );
      await chanSel.update({
        content: `✅ ${config.channelIds.length} salon(s) sélectionné(s)\n\n**2/3 — Rôles interdits**\nQuels rôles n’ont PAS le droit de poster des liens dans ces salons ?`,
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
        new ButtonBuilder().setCustomId('cfgl_done').setLabel('Terminer').setStyle(ButtonStyle.Success),
      );

      const step3Text = () =>
        `✅ ${config.roleIds.length} rôle(s) bloqué(s)\n\n` +
        `**3/3 — Rôles autorisés (exceptions)** *(facultatif)*\n` +
        `Ces rôles pourront **toujours** poster des liens, même s’ils ont un rôle bloqué.\n` +
        (config.allowedRoleIds.length ? `Sélectionnés : ${config.allowedRoleIds.map((r) => `<@&${r}>`).join(' ')}\n` : '') +
        `Clique sur **Terminer** pour valider (avec ou sans exception).`;

      await roleSel.update({ content: step3Text(), components: [allowRow, doneRow] });

      // Boucle : on accepte les changements d'exceptions jusqu'au clic sur "Terminer".
      for (;;) {
        const sel = await msg.awaitMessageComponent({ time: 300_000, filter });
        if (sel.customId === 'cfgl_allow') {
          config.allowedRoleIds = sel.values;
          await sel.update({ content: step3Text(), components: [allowRow, doneRow] });
        } else {
          setLinkConfig(interaction.guild.id, config);
          await sel.update({
            content:
              `✅ **Filtre anti-liens configuré !**\n` +
              `• Salons : ${config.channelIds.map((c) => `<#${c}>`).join(' ')}\n` +
              `• Rôles bloqués : ${config.roleIds.map((r) => `<@&${r}>`).join(' ')}\n` +
              `• Rôles autorisés (exceptions) : ${config.allowedRoleIds.length ? config.allowedRoleIds.map((r) => `<@&${r}>`).join(' ') : '_aucun_'}\n\n` +
              `Tout membre portant un rôle bloqué verra ses messages avec liens supprimés — sauf s’il a aussi un rôle autorisé.`,
            components: [],
          });
          break;
        }
      }
    } catch (err) {
      console.error(err);
      return interaction.editReply({ content: '⏱️ Configuration annulée (délai dépassé). Relance `/configlien`.', components: [] }).catch(() => {});
    }
  },
};
