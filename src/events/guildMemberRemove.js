import { Events, EmbedBuilder, AuditLogEvent } from 'discord.js';
import { sendLog, sendInviteLog, Colors, findAuditEntry } from '../lib/logger.js';
import { addMemberEvent, recordInviteLeave } from '../lib/store.js';
import { sendGreeting } from '../lib/greetings.js';
import { onMemberLeave } from '../lib/verification.js';
import { syncInviteRankRole } from '../lib/inviterank.js';

export default {
  name: Events.GuildMemberRemove,
  async execute(member) {
    if (member.user?.bot) return;

    // Supprime le captcha de vérification en attente pour ce membre
    await onMemberLeave(member).catch((err) => console.error(err));

    addMemberEvent(member.guild.id, 'leave', member.id);

    // Décompte d'invitation : si ce membre avait été invité par quelqu'un,
    // on retire une invitation à son parrain et on réajuste son rôle de palier.
    const invite = recordInviteLeave(member.guild.id, member.id);
    if (invite) {
      await syncInviteRankRole(member.guild, invite.inviterId, invite.total).catch(() => {});
      const leaveEmbed = new EmbedBuilder()
        .setColor(Colors.leave)
        .setAuthor({ name: '📉 Invitation perdue' })
        .setDescription(
          `<@${invite.inviterId}> perd une invitation (départ de **${member.user?.tag ?? 'un membre'}**) — total : **${invite.total}**.`,
        )
        .addFields({
          name: 'Rejoint via',
          value: invite.code ? `\`discord.gg/${invite.code}\`` : 'Lien inconnu',
          inline: true,
        })
        .setTimestamp();
      await sendInviteLog(member.guild, leaveEmbed);
    }

    // Détecte si ce départ est en fait une expulsion (kick) faite via Discord/un autre bot.
    // La commande /kick du bot loggue déjà elle-même → on ignore si l'exécuteur est le bot.
    const kick = await findAuditEntry(member.guild, AuditLogEvent.MemberKick, member.id);
    if (kick && kick.executor?.id !== member.guild.client.user.id) {
      await sendLog(
        member.guild,
        new EmbedBuilder()
          .setColor(Colors.leave)
          .setAuthor({ name: '👢 Membre expulsé' })
          .setDescription(`${member.user.tag} (\`${member.id}\`)`)
          .addFields(
            { name: 'Raison', value: kick.reason || 'Aucune raison précisée' },
            { name: 'Par', value: kick.executor ? `${kick.executor}` : 'Inconnu', inline: true },
          )
          .setTimestamp(),
      );
    }

    // Message de départ (si configuré)
    await sendGreeting(member.guild, 'leave', member).catch((err) => console.error(err));

    const embed = new EmbedBuilder()
      .setColor(Colors.leave)
      .setAuthor({ name: '📤 Départ', iconURL: member.user?.displayAvatarURL?.() })
      .setDescription(`**${member.user?.tag ?? 'Membre inconnu'}** a quitté le serveur`)
      .setTimestamp();

    if (member.joinedTimestamp) {
      embed.addFields({
        name: 'Avait rejoint',
        value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`,
        inline: true,
      });
    }

    // Lien d'invitation utilisé à l'arrivée (si connu).
    if (invite) {
      embed.addFields(
        {
          name: 'Rejoint via',
          value: invite.code ? `\`discord.gg/${invite.code}\`` : 'Lien inconnu',
          inline: true,
        },
        { name: 'Invité par', value: `<@${invite.inviterId}>`, inline: true },
      );
    }

    await sendLog(member.guild, embed);
  },
};
