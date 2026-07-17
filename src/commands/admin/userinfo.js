import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { getWarns } from '../../lib/store.js';

export default {
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Afficher la fiche d’un membre.')
    .addUserOption((o) => o.setName('membre').setDescription('Le membre (vide = toi)'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false),

  async execute(interaction) {
    const target = interaction.options.getUser('membre') ?? interaction.user;
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    const warns = getWarns(interaction.guild.id, target.id);

    const roles = member
      ? member.roles.cache.filter((r) => r.id !== interaction.guild.id).sort((a, b) => b.position - a.position).map((r) => `${r}`).slice(0, 20).join(' ') || 'Aucun'
      : 'Membre absent du serveur';

    const embed = new EmbedBuilder()
      .setColor(member?.displayColor || 0x5865f2)
      .setAuthor({ name: target.tag, iconURL: target.displayAvatarURL() })
      .setThumbnail(target.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: 'ID', value: `\`${target.id}\``, inline: true },
        { name: 'Bot', value: target.bot ? 'Oui' : 'Non', inline: true },
        { name: 'Avertissements', value: `${warns.length}`, inline: true },
        { name: 'Compte créé', value: `<t:${Math.floor(target.createdTimestamp / 1000)}:D> (<t:${Math.floor(target.createdTimestamp / 1000)}:R>)` },
      )
      .setTimestamp();

    if (member?.joinedTimestamp) {
      embed.addFields({
        name: 'A rejoint',
        value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:D> (<t:${Math.floor(member.joinedTimestamp / 1000)}:R>)`,
      });
    }
    embed.addFields({ name: `Rôles`, value: roles });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
