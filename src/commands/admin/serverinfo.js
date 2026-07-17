import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('Afficher les statistiques du serveur.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false),

  async execute(interaction) {
    const g = interaction.guild;
    await g.members.fetch().catch(() => {});
    const owner = await g.fetchOwner().catch(() => null);

    const channels = g.channels.cache;
    const text = channels.filter((c) => c.type === ChannelType.GuildText).size;
    const voice = channels.filter((c) => c.type === ChannelType.GuildVoice).size;
    const humans = g.members.cache.filter((m) => !m.user.bot).size;
    const bots = g.members.cache.filter((m) => m.user.bot).size;

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`📊 ${g.name}`)
      .setThumbnail(g.iconURL({ size: 256 }))
      .addFields(
        { name: 'Propriétaire', value: owner ? `${owner.user.tag}` : 'Inconnu', inline: true },
        { name: 'Membres', value: `${g.memberCount}`, inline: true },
        { name: 'Humains / Bots', value: `${humans} / ${bots}`, inline: true },
        { name: 'Salons texte', value: `${text}`, inline: true },
        { name: 'Salons vocaux', value: `${voice}`, inline: true },
        { name: 'Rôles', value: `${g.roles.cache.size}`, inline: true },
        { name: 'Emojis', value: `${g.emojis.cache.size}`, inline: true },
        { name: 'Boosts', value: `${g.premiumSubscriptionCount ?? 0} (niveau ${g.premiumTier})`, inline: true },
        { name: 'Créé le', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:D>`, inline: true },
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
