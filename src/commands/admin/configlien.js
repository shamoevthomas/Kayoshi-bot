import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
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
    const config = { channelIds: [], roleIds: [] };

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
        content: `✅ ${config.channelIds.length} salon(s) sélectionné(s)\n\n**2/2 — Rôles interdits**\nQuels rôles n’ont PAS le droit de poster des liens dans ces salons ?`,
        components: [roleRow],
      });

      const roleSel = await msg.awaitMessageComponent({ componentType: ComponentType.RoleSelect, time: 300_000, filter });
      config.roleIds = roleSel.values;

      setLinkConfig(interaction.guild.id, config);
      await roleSel.update({
        content:
          `✅ **Filtre anti-liens configuré !**\n` +
          `• Salons : ${config.channelIds.map((c) => `<#${c}>`).join(' ')}\n` +
          `• Rôles bloqués : ${config.roleIds.map((r) => `<@&${r}>`).join(' ')}\n\n` +
          `Tout membre portant un de ces rôles verra ses messages avec liens supprimés dans ces salons.`,
        components: [],
      });
    } catch (err) {
      console.error(err);
      return interaction.editReply({ content: '⏱️ Configuration annulée (délai dépassé). Relance `/configlien`.', components: [] }).catch(() => {});
    }
  },
};
