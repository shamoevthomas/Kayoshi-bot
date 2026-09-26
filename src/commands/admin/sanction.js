import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { setGuildConfig, getGuildConfig } from '../../lib/store.js';

export default {
  data: new SlashCommandBuilder()
    .setName('sanction')
    .setDescription('Créer le salon où sont enregistrées toutes les sanctions (à la place des logs).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    const guild = interaction.guild;
    const { sanctionChannelId, logChannelId } = getGuildConfig(guild.id);

    const existing = sanctionChannelId && (await guild.channels.fetch(sanctionChannelId).catch(() => null));
    if (existing) {
      return interaction.reply({
        content: `ℹ️ Le salon des sanctions existe déjà : ${existing}\n_(supprime-le puis relance \`/sanction\` pour en recréer un)_`,
        ephemeral: true,
      });
    }

    // Même catégorie et mêmes permissions que le salon de logs (le staff qui voit
    // les logs voit aussi les sanctions) ; sinon salon privé.
    const logChannel = logChannelId && (await guild.channels.fetch(logChannelId).catch(() => null));
    const botId = interaction.client.user.id;
    const overwrites = logChannel
      ? [...logChannel.permissionOverwrites.cache.values()]
          .filter((o) => o.id !== botId)
          .map((o) => ({ id: o.id, type: o.type, allow: o.allow, deny: o.deny }))
      : [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }];
    overwrites.push({
      id: botId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks],
    });

    let channel;
    try {
      channel = await guild.channels.create({
        name: 'kayoshi-sanctions',
        type: ChannelType.GuildText,
        topic: 'Sanctions des membres (warn, mute, kick, ban, derank, anti-spam) — Kayoshi.',
        parent: logChannel?.parentId ?? null,
        permissionOverwrites: overwrites,
      });
    } catch (err) {
      return interaction.reply({ content: `❌ Impossible de créer le salon : ${err?.message ?? 'erreur inconnue'}`, ephemeral: true });
    }

    setGuildConfig(guild.id, { sanctionChannelId: channel.id });
    return interaction.reply({
      content:
        `✅ Salon des sanctions créé : ${channel}\n` +
        `Désormais, les warns, mutes, kicks, bans, deranks et sanctions anti-spam y sont enregistrés — plus dans les logs.`,
      ephemeral: true,
    });
  },
};
