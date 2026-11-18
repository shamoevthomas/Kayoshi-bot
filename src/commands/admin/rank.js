import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { isHierarchyExempt } from '../../lib/roles.js';
import { getRankConfig } from '../../lib/store.js';
import { Colors } from '../../lib/logger.js';
import { renderRankAnnouncement, listRoles } from '../../lib/rank.js';

// Donne jusqu'à MAX_ROLES rôles à un membre, puis poste l'annonce (message de /config → Rank / derank)
// en embed dans le salon configuré.
const MAX_ROLES = 6;

export default {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Donner jusqu’à 6 rôles à un membre et l’annoncer dans le salon de /config → Rank / derank.')
    .addUserOption((o) => o.setName('membre').setDescription('Le membre à rank').setRequired(true))
    .addRoleOption((o) => o.setName('role').setDescription('Le rôle à donner').setRequired(true))
    .addRoleOption((o) => o.setName('role_2').setDescription('(Facultatif) Un 2ᵉ rôle à donner'))
    .addRoleOption((o) => o.setName('role_3').setDescription('(Facultatif) Un 3ᵉ rôle à donner'))
    .addRoleOption((o) => o.setName('role_4').setDescription('(Facultatif) Un 4ᵉ rôle à donner'))
    .addRoleOption((o) => o.setName('role_5').setDescription('(Facultatif) Un 5ᵉ rôle à donner'))
    .addRoleOption((o) => o.setName('role_6').setDescription('(Facultatif) Un 6ᵉ rôle à donner'))
    .addStringOption((o) => o.setName('motif').setDescription('(Facultatif) Le motif du rank').setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false),

  async execute(interaction) {
    const target = interaction.options.getUser('membre');
    const motif = interaction.options.getString('motif');
    const roles = ['role', ...Array.from({ length: MAX_ROLES - 1 }, (_, i) => `role_${i + 2}`)]
      .map((name) => interaction.options.getRole(name))
      .filter(Boolean)
      .filter((r, i, all) => all.findIndex((x) => x.id === r.id) === i);

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) return interaction.reply({ content: '❌ Membre introuvable.', ephemeral: true });

    // Validité des rôles et hiérarchie (bot, et staff qui fait le /rank).
    const me = interaction.guild.members.me;
    const isOwner = isHierarchyExempt(interaction.guild, interaction.user.id); // propriétaire ou exempté
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
      return interaction.reply({ content: `ℹ️ ${target} a déjà ${listRoles(roles)}.`, ephemeral: true });
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
      note = '\nℹ️ Aucune annonce postée : configure le salon et le message avec `/config → Rank / derank`.';
    } else if (!channel) {
      note = '\n⚠️ Le salon des annonces de rank n’existe plus. Relance `/config → Rank / derank`.';
    } else {
      const embed = new EmbedBuilder()
        .setColor(Colors.join)
        .setDescription(renderRankAnnouncement(config.message, { member, roles: toGive, motif, staff: interaction.user }, 'Rank up'))
        .setThumbnail(member.displayAvatarURL())
        .setTimestamp();
      const sent = await channel.send({ embeds: [embed] }).catch((err) => {
        console.error('[rank] annonce impossible :', err.message);
        return null;
      });
      note = sent ? `\n📣 Annonce postée dans ${channel}.` : `\n⚠️ Je n’ai pas pu poster l’annonce dans ${channel} (permissions ?).`;
    }

    return interaction.editReply({ content: `✅ ${target} a reçu ${listRoles(toGive)}.${note}` });
  },
};
