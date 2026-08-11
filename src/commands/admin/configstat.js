import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { getStatConfig, setStatConfig } from '../../lib/store.js';
import { postStatMessage } from '../../lib/activity.js';

export default {
  data: new SlashCommandBuilder()
    .setName('configstat')
    .setDescription('Choisir le salon du classement des membres les plus actifs de la semaine.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addChannelOption((o) =>
      o
        .setName('salon')
        .setDescription('Salon où afficher le classement (actualisé toutes les 10 min)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true),
    ),

  async execute(interaction) {
    const channel = interaction.options.getChannel('salon');
    const me = interaction.guild.members.me;
    const perms = channel.permissionsFor(me);
    if (!perms?.has(PermissionFlagsBits.SendMessages) || !perms.has(PermissionFlagsBits.EmbedLinks)) {
      return interaction.reply({
        content: `❌ Il me faut les permissions **Envoyer des messages** et **Intégrer des liens** dans ${channel}.`,
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    // Supprime l'ancien message de classement s'il en existait un.
    const old = getStatConfig(interaction.guild.id);
    if (old?.channelId && old.messageId) {
      const oldChan =
        interaction.guild.channels.cache.get(old.channelId) ??
        (await interaction.guild.channels.fetch(old.channelId).catch(() => null));
      const oldMsg = oldChan?.isTextBased?.() ? await oldChan.messages.fetch(old.messageId).catch(() => null) : null;
      await oldMsg?.delete().catch(() => {});
    }

    const messageId = await postStatMessage(interaction.guild, channel).catch((err) => {
      console.error('[configstat] envoi échoué :', err);
      return null;
    });
    if (!messageId) {
      return interaction.editReply({ content: `❌ Impossible d'envoyer le message dans ${channel}.` });
    }

    setStatConfig(interaction.guild.id, { channelId: channel.id, messageId });
    return interaction.editReply({
      content: `✅ Classement des plus actifs configuré dans ${channel}.\nIl se met à jour **toutes les 10 minutes** et se réinitialise chaque **lundi**.`,
    });
  },
};
