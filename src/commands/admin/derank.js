import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { sendSanctionLog, Colors } from '../../lib/logger.js';
import { getRankConfig } from '../../lib/store.js';
import { recordSanction } from '../../lib/sanctions.js';
import { renderRankAnnouncement, listRoles, DEFAULT_DERANK_MESSAGE } from '../../lib/rank.js';

const MAX_ROLES = 5;
const ROLE_OPTIONS = ['role', ...Array.from({ length: MAX_ROLES - 1 }, (_, i) => `role_${i + 2}`)];

const data = new SlashCommandBuilder()
  .setName('derank')
  .setDescription(`Retirer jusqu’à ${MAX_ROLES} rôles à un membre et le prévenir en message privé.`)
  .addUserOption((o) => o.setName('membre').setDescription('Le membre à derank').setRequired(true))
  .addRoleOption((o) => o.setName('role').setDescription('Le rôle à retirer').setRequired(true))
  .addStringOption((o) => o.setName('raison').setDescription('La raison du derank').setRequired(true));
for (const [i, name] of ROLE_OPTIONS.slice(1).entries()) {
  data.addRoleOption((o) => o.setName(name).setDescription(`(Facultatif) Un ${i + 2}ᵉ rôle à retirer`));
}
data.setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles).setDMPermission(false);

export default {
  data,

  async execute(interaction) {
    const target = interaction.options.getUser('membre');
    const reason = interaction.options.getString('raison');
    const roles = ROLE_OPTIONS.map((name) => interaction.options.getRole(name))
      .filter(Boolean)
      .filter((r, i, all) => all.findIndex((x) => x.id === r.id) === i);

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) return interaction.reply({ content: '❌ Membre introuvable.', ephemeral: true });

    // Validité des rôles et hiérarchie (bot, et staff qui fait le /derank), comme /rank.
    const me = interaction.guild.members.me;
    const isOwner = interaction.user.id === interaction.guild.ownerId;
    for (const role of roles) {
      if (role.id === interaction.guild.id) {
        return interaction.reply({ content: '❌ Impossible de retirer le rôle @everyone.', ephemeral: true });
      }
      if (role.managed) {
        return interaction.reply({ content: `❌ Le rôle ${role} est géré par une intégration, impossible de le retirer manuellement.`, ephemeral: true });
      }
      if (role.position >= me.roles.highest.position) {
        return interaction.reply({ content: `❌ Le rôle ${role} est au-dessus de mon rôle le plus haut, je ne peux pas le gérer.`, ephemeral: true });
      }
      if (!isOwner && role.position >= interaction.member.roles.highest.position) {
        return interaction.reply({ content: `❌ Le rôle ${role} est au-dessus (ou au niveau) de ton rôle le plus haut.`, ephemeral: true });
      }
    }

    const toRemove = roles.filter((r) => member.roles.cache.has(r.id));
    const missing = roles.filter((r) => !member.roles.cache.has(r.id));
    if (!toRemove.length) {
      return interaction.reply({
        content: `ℹ️ ${target} n'a ${roles.length > 1 ? `aucun de ces rôles : ${listRoles(roles)}` : `pas le rôle ${roles[0]}`}.`,
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    // MP AVANT le retrait (le membre pourrait devenir injoignable sinon).
    let dmSent = true;
    await target
      .send(
        `Bonjour ${target.username}, vous avez été derank de **${interaction.guild.name}** ` +
          `pour la raison suivante : ${reason}`,
      )
      .catch(() => {
        dmSent = false;
      });

    try {
      await member.roles.remove(toRemove, `Derank par ${interaction.user.tag} : ${reason}`);
      recordSanction(interaction.guild.id, target.id, 'derank', { reason: `${reason} (${toRemove.map((r) => r.name).join(', ')})`, by: interaction.user.id });
    } catch (err) {
      console.error('[derank] échec :', err);
      return interaction.editReply({ content: `❌ Impossible de retirer ${toRemove.length > 1 ? 'les rôles' : 'le rôle'} : ${err?.message ?? 'erreur inconnue'}` });
    }

    await sendSanctionLog(
      interaction.guild,
      new EmbedBuilder()
        .setColor(Colors.role)
        .setAuthor({ name: '⬇️ Derank' })
        .setDescription(`${listRoles(toRemove)} retiré${toRemove.length > 1 ? 's' : ''} à ${target} (${target.tag})`)
        .addFields(
          { name: 'Raison', value: reason },
          { name: 'Par', value: `${interaction.user}`, inline: true },
          { name: 'MP envoyé', value: dmSent ? '✅ oui' : '❌ non (MP fermés)', inline: true },
        )
        .setTimestamp(),
    );

    // Annonce dans le salon de /configrank (message /derank de /configrank), comme /rank.
    const config = getRankConfig(interaction.guild.id);
    const channel = config?.channelId ? interaction.guild.channels.cache.get(config.channelId) : null;
    let note = '';
    if (!config) {
      note = '\nℹ️ Aucune annonce postée : configure le salon avec `/configrank`.';
    } else if (!channel) {
      note = '\n⚠️ Le salon des annonces de rank n’existe plus. Relance `/configrank`.';
    } else {
      const embed = new EmbedBuilder()
        .setColor(Colors.leave)
        .setDescription(
          renderRankAnnouncement(
            config.derankMessage ?? DEFAULT_DERANK_MESSAGE,
            { member, roles: toRemove, motif: reason, staff: interaction.user },
            'Derank',
          ),
        )
        .setThumbnail(member.displayAvatarURL())
        .setTimestamp();
      const sent = await channel.send({ embeds: [embed] }).catch((err) => {
        console.error('[derank] annonce impossible :', err.message);
        return null;
      });
      note = sent ? `\n📣 Annonce postée dans ${channel}.` : `\n⚠️ Je n’ai pas pu poster l’annonce dans ${channel} (permissions ?).`;
    }

    return interaction.editReply({
      content:
        `✅ ${target} a été derank de ${listRoles(toRemove)}.` +
        (missing.length ? `\nℹ️ ${target} n'avait déjà pas ${listRoles(missing)}.` : '') +
        (dmSent ? '' : "\n⚠️ Je n'ai pas pu lui envoyer de MP (messages privés fermés).") +
        note,
    });
  },
};
