import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ComponentType,
} from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ghostping')
    .setDescription('Mentionner un rôle (ou @everyone/@here) dans un salon puis supprimer le message aussitôt.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    const filter = (i) => i.user.id === interaction.user.id;

    // ===== 1/2 — Choix de la mention =====
    const roleRow = new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder().setCustomId('gp_role').setPlaceholder('Choisis un rôle à mentionner').setMinValues(1).setMaxValues(1),
    );
    const specialRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('gp_everyone').setLabel('@everyone').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('gp_here').setLabel('@here').setStyle(ButtonStyle.Secondary),
    );

    const msg = await interaction.reply({
      content: '**1/2 — Mention**\nChoisis un **rôle**, ou clique sur **@everyone** / **@here** :',
      components: [roleRow, specialRow],
      ephemeral: true,
      fetchReply: true,
    });

    let sel;
    try {
      sel = await msg.awaitMessageComponent({ time: 120_000, filter });
    } catch {
      return interaction.editReply({ content: '⏳ Temps écoulé. Relance `/ghostping`.', components: [] }).catch(() => {});
    }

    let mention;
    let allowedMentions;
    let labelStr;
    if (sel.customId === 'gp_role') {
      const roleId = sel.values[0];
      mention = `<@&${roleId}>`;
      allowedMentions = { roles: [roleId] };
      labelStr = `<@&${roleId}>`;
    } else if (sel.customId === 'gp_everyone') {
      mention = '@everyone';
      allowedMentions = { parse: ['everyone'] };
      labelStr = '@everyone';
    } else {
      mention = '@here';
      allowedMentions = { parse: ['everyone'] };
      labelStr = '@here';
    }

    // ===== 2/2 — Salon =====
    const chanRow = new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId('gp_chan')
        .setPlaceholder('Salon où envoyer le ghost ping')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(1)
        .setMaxValues(1),
    );
    await sel.update({ content: `✅ Mention : ${labelStr}\n\n**2/2 — Salon**\nOù envoyer le ghost ping ?`, components: [chanRow] });

    let chanSel;
    try {
      chanSel = await msg.awaitMessageComponent({ componentType: ComponentType.ChannelSelect, time: 120_000, filter });
    } catch {
      return interaction.editReply({ content: '⏳ Temps écoulé. Relance `/ghostping`.', components: [] }).catch(() => {});
    }

    const channel = chanSel.channels?.first() ?? interaction.guild.channels.cache.get(chanSel.values[0]);
    const me = interaction.guild.members.me;
    const perms = channel?.permissionsFor(me);
    if (!perms?.has(PermissionFlagsBits.SendMessages) || !perms.has(PermissionFlagsBits.ManageMessages)) {
      return chanSel.update({
        content: `❌ Il me faut **Envoyer des messages** et **Gérer les messages** dans ${channel} pour faire un ghost ping.`,
        components: [],
      });
    }

    await chanSel.update({ content: '⏳ Envoi du ghost ping…', components: [] });

    try {
      const sent = await channel.send({ content: mention, allowedMentions });
      await sent.delete();
      return interaction.editReply({ content: `👻 Ghost ping ${labelStr} envoyé dans ${channel} (message supprimé).` }).catch(() => {});
    } catch (err) {
      console.error('[ghostping] échec :', err);
      return interaction.editReply({ content: `❌ Échec du ghost ping : ${err?.message ?? 'erreur inconnue'}` }).catch(() => {});
    }
  },
};
