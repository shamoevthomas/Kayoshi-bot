import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { isOneMessageChannel, addOneMessageChannel, removeOneMessageChannel } from '../../lib/store.js';

export default {
  data: new SlashCommandBuilder()
    .setName('reset')
    .setDescription('Supprime un salon et le recrée à l’identique (même nom et mêmes permissions).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false)
    .addChannelOption((o) =>
      o.setName('salon').setDescription('Le salon à réinitialiser (par défaut : le salon actuel)'),
    ),

  async execute(interaction) {
    const channel = interaction.options.getChannel('salon') ?? interaction.channel;

    const me = interaction.guild.members.me;
    if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply({ content: '❌ Il me manque la permission **Gérer les salons**.', ephemeral: true });
    }
    if (!channel.manageable) {
      return interaction.reply({ content: `❌ Je ne peux pas gérer ${channel} (permissions ou hiérarchie).`, ephemeral: true });
    }

    const confirm = new ButtonBuilder().setCustomId('reset_confirm').setLabel('Oui, réinitialiser').setStyle(ButtonStyle.Danger).setEmoji('🧹');
    const cancel = new ButtonBuilder().setCustomId('reset_cancel').setLabel('Annuler').setStyle(ButtonStyle.Secondary);
    const row = new ActionRowBuilder().addComponents(confirm, cancel);

    const prompt = await interaction.reply({
      content: `⚠️ Tu vas **supprimer puis recréer** ${channel} à l'identique (même nom, mêmes permissions). **Tous les messages seront perdus.** Confirmer ?`,
      components: [row],
      ephemeral: true,
      fetchReply: true,
    });

    let choice;
    try {
      choice = await prompt.awaitMessageComponent({ filter: (i) => i.user.id === interaction.user.id, time: 30_000 });
    } catch {
      return interaction.editReply({ content: '⏳ Temps écoulé, opération annulée.', components: [] }).catch(() => {});
    }
    if (choice.customId === 'reset_cancel') {
      return choice.update({ content: '❌ Opération annulée.', components: [] }).catch(() => {});
    }

    await choice.update({ content: '⏳ Réinitialisation du salon…', components: [] }).catch(() => {});

    try {
      const position = channel.rawPosition;
      const wasOneMessage = isOneMessageChannel(interaction.guild.id, channel.id);

      // clone() recrée un salon identique : nom, permissions, catégorie, sujet,
      // NSFW, mode lent, etc.
      const clone = await channel.clone({ reason: `reset par ${interaction.user.tag}` });
      await clone.setPosition(position).catch(() => {});
      await channel.delete(`reset par ${interaction.user.tag}`);

      // Reporte la config "one-message" sur le nouveau salon si besoin.
      if (wasOneMessage) {
        removeOneMessageChannel(interaction.guild.id, channel.id);
        addOneMessageChannel(interaction.guild.id, clone.id);
      }

      if (clone.isTextBased()) {
        await clone.send(`🧹 Salon réinitialisé par ${interaction.user}.`).catch(() => {});
      }
      return interaction.editReply({ content: `✅ ${clone} a été réinitialisé (même nom, mêmes permissions).`, components: [] }).catch(() => {});
    } catch (err) {
      console.error('[reset] échec :', err);
      return interaction
        .editReply({ content: `❌ Échec de la réinitialisation : ${err?.message ?? 'erreur inconnue'}`, components: [] })
        .catch(() => {});
    }
  },
};
