import { Events, EmbedBuilder } from 'discord.js';
import { sendLog, Colors } from '../lib/logger.js';
import { addMemberEvent, countJoins, addInviteCredit } from '../lib/store.js';
import { onMemberJoin } from '../lib/verification.js';
import { sendGreeting } from '../lib/greetings.js';
import { detectUsedInvite } from '../lib/invites.js';
import { syncInviteRankRole } from '../lib/inviterank.js';

export default {
  name: Events.GuildMemberAdd,
  async execute(member) {
    if (member.user.bot) return;

    // Détecte l'invitation utilisée AVANT tout traitement, tant que l'écart de
    // compteur avec le cache est encore frais.
    const used = await detectUsedInvite(member.guild).catch(() => null);

    addMemberEvent(member.guild.id, 'join', member.id);
    // countJoins inclut l'arrivée qu'on vient d'enregistrer → on retire 1.
    const previousJoins = Math.max(0, countJoins(member.guild.id, member.id) - 1);

    // Vérification anti-bot (si configurée)
    await onMemberJoin(member).catch((err) => console.error(err));
    // Message de bienvenue (si configuré)
    await sendGreeting(member.guild, 'welcome', member).catch((err) => console.error(err));

    const embed = new EmbedBuilder()
      .setColor(Colors.join)
      .setAuthor({ name: '📥 Arrivée', iconURL: member.user.displayAvatarURL() })
      .setDescription(`${member} (${member.user.tag}) a rejoint le serveur`)
      .addFields(
        {
          name: 'Compte créé',
          value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`,
          inline: true,
        },
        {
          name: 'Déjà venu',
          value: previousJoins > 0 ? `**${previousJoins}** fois auparavant` : 'Première arrivée',
          inline: true,
        },
      )
      .setTimestamp();

    // --- Informations d'invitation ---
    if (used?.vanity) {
      embed.addFields({
        name: 'Invitation',
        value: `Lien personnalisé — \`discord.gg/${used.code}\``,
        inline: false,
      });
    } else if (used?.inviter) {
      const total = addInviteCredit(member.guild.id, used.inviter.id);
      embed.addFields(
        { name: 'Invitation', value: `\`discord.gg/${used.code}\``, inline: true },
        { name: 'Créée par', value: `${used.inviter} (${used.inviter.tag})`, inline: true },
        {
          name: `Invitations de ${used.inviter.username}`,
          value: `**${total}** membre(s) invité(s) au total`,
          inline: false,
        },
      );

      // Fait évoluer le rôle de palier du parrain selon son nouveau total.
      const promoted = await syncInviteRankRole(member.guild, used.inviter.id, total).catch(() => null);
      if (promoted) {
        await sendLog(
          member.guild,
          new EmbedBuilder()
            .setColor(Colors.role)
            .setAuthor({ name: '🏆 Palier d’invitations atteint', iconURL: used.inviter.displayAvatarURL() })
            .setDescription(
              `${used.inviter} a atteint **${promoted.count} invitation(s)** et débloque <@&${promoted.roleId}> !`,
            )
            .setTimestamp(),
        );
      }
    } else if (used?.code) {
      // Invitation détectée mais créateur inconnu (ex. cache incomplet).
      embed.addFields({ name: 'Invitation', value: `\`discord.gg/${used.code}\``, inline: true });
    } else {
      embed.addFields({ name: 'Invitation', value: 'Indéterminée', inline: true });
    }

    await sendLog(member.guild, embed);
  },
};
