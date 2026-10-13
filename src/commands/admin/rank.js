import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { getRankConfig } from '../../lib/store.js';
import { Colors } from '../../lib/logger.js';
import { renderRankMessage } from '../../lib/rank.js';

// Donne un ou deux rôles à un membre, puis poste l'annonce (message de /configrank)
// en embed dans le salon configuré.
export default {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Donner un rôle à un membre et l’annoncer dans le salon de /configrank.')
    .addUserOption((o) => o.setName('membre').setDescription('Le membre à rank').setRequired(true))
    .addRoleOption((o) => o.setName('role').setDescription('Le rôle à donner').setRequired(true))
    .addRoleOption((o) => o.setName('role_2').setDescription('(Facultatif) Un 2ᵉ rôle à donner'))
    .addStringOption((o) => o.setName('motif').setDescription('(Facultatif) Le motif du rank').setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false),

  async execute(interaction) {
    const target = interaction.options.getUser('membre');
    const motif = interaction.options.getString('motif');
    const roles = [interaction.options.getRole('role'), interaction.options.getRole('role_2')]
      .filter(Boolean)
      .filter((r, i, all) => all.findIndex((x) => x.id === r.id) === i);

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) return interaction.reply({ content: '❌ Membre introuvable.', ephemeral: true });

    // Validité des rôles et hiérarchie (bot, et staff qui fait le /rank).
    const me = interaction.guild.members.me;
    const isOwner = interaction.user.id === interaction.guild.ownerId;
    for (const role of roles) {
      if (role.id === interaction.guild.id) {
        return interaction.reply({ content: '❌ Impossible de donner le rôle @everyone.', ephemeral: true });
      }
      if (role.managed) {
        return interaction.reply({ content: `❌ Le rôle ${role} est géré par une intégration, impossible de le donner.`, ephemeral: true });
      }
      if (role.position >= me.roles.highest.position) {
        return interaction.reply({ content: `❌ Le rôle ${role} est au-dessus de mon rôle le plus haut, je ne peux pas le donner.`, ephemeral: true });
      }
      if (!isOwner && role.position >= interaction.member.roles.highest.position) {
        return interaction.reply({ content: `❌ Le rôle ${role} est au-dessus (ou au niveau) de ton rôle le plus haut.`, ephemeral: true });
      }
    }

    const toGive = roles.filter((r) => !member.roles.cache.has(r.id));
    if (!toGive.length) {
      return interaction.reply({ content: `ℹ️ ${target} a déjà ${roles.join(' et ')}.`, ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    try {
      await member.roles.add(toGive, `Rank par ${interaction.user.tag}${motif ? ` : ${motif}` : ''}`);
    } catch (err) {
      console.error('[rank] échec :', err);
      return interaction.editReply({ content: `❌ Impossible de donner le rôle : ${err?.message ?? 'erreur inconnue'}` });
    }

    // Annonce dans le salon configuré.
    const config = getRankConfig(interaction.guild.id);
    const channel = config?.channelId ? interaction.guild.channels.cache.get(config.channelId) : null;
    let note = '';
    if (!config) {
      note = '\nℹ️ Aucune annonce postée : configure le salon et le message avec `/configrank`.';
    } else if (!channel) {
      note = '\n⚠️ Le salon des annonces de rank n’existe plus. Relance `/configrank`.';
    } else {
      const embed = new EmbedBuilder()
        .setColor(Colors.join)
        .setDescription(renderRankMessage(config.message, { member, roles: toGive, motif, staff: interaction.user }).slice(0, 4096))
        .setThumbnail(member.displayAvatarURL())
        .setTimestamp();
      const sent = await channel.send({ embeds: [embed] }).catch((err) => {
        console.error('[rank] annonce impossible :', err.message);
        return null;
      });
      note = sent ? `\n📣 Annonce postée dans ${channel}.` : `\n⚠️ Je n’ai pas pu poster l’annonce dans ${channel} (permissions ?).`;
    }

    return interaction.editReply({ content: `✅ ${target} a reçu ${toGive.join(' et ')}.${note}` });
  },
};
