import { Events, EmbedBuilder } from 'discord.js';
import { sendLog, sendInviteLog, Colors } from '../lib/logger.js';
import { addMemberEvent, countJoins, recordInviteJoin } from '../lib/store.js';
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

    // --- Log d'arrivée (salon de logs général) ---
    await sendLog(
      member.guild,
      new EmbedBuilder()
        .setColor(Colors.join)
        .setAuthor({ name: '📥 Arrivée', iconURL: member.user.displayAvatarURL() })
        .setDescription(`${member} (${member.user.tag}) a rejoint le serveur`)
        .addFields({
          name: 'Compte créé',
          value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`,
          inline: true,
        })
        .setTimestamp(),
    );

    // --- Suivi d'invitation (salon dédié via /inviteconfig) ---
    const inviteEmbed = new EmbedBuilder()
      .setColor(Colors.join)
      .setAuthor({ name: '📨 Suivi d’invitation', iconURL: member.user.displayAvatarURL() })
      .setDescription(`${member} (${member.user.tag}) a rejoint le serveur.`)
      .addFields({
        name: 'Déjà venu',
        value: previousJoins > 0 ? `**${previousJoins}** fois auparavant` : 'Première arrivée',
        inline: true,
      })
      .setTimestamp();

    if (used?.vanity) {
      inviteEmbed.addFields({
        name: 'Invitation',
        value: `Lien personnalisé — \`discord.gg/${used.code}\``,
        inline: true,
      });
    } else if (used?.inviter) {
      const total = recordInviteJoin(member.guild.id, used.inviter.id, member.id, used.code);
      inviteEmbed.addFields(
        { name: 'Invité par', value: `${used.inviter} (${used.inviter.tag})`, inline: true },
        { name: 'Lien utilisé', value: `\`discord.gg/${used.code}\``, inline: true },
        {
          name: `Total de ${used.inviter.username}`,
          value: `**${total}** membre(s) invité(s)`,
          inline: false,
        },
      );

      // Fait évoluer le rôle de palier du parrain selon son nouveau total.
      const promoted = await syncInviteRankRole(member.guild, used.inviter.id, total).catch(() => null);
      if (promoted) {
        inviteEmbed.addFields({
          name: '🏆 Palier atteint',
          value: `${used.inviter} débloque <@&${promoted.roleId}> (${promoted.count}+) !`,
          inline: false,
        });
      }
    } else if (used?.code) {
      // Invitation détectée mais créateur inconnu (ex. cache incomplet).
      inviteEmbed.addFields({ name: 'Invitation', value: `\`discord.gg/${used.code}\``, inline: true });
    } else {
      inviteEmbed.addFields({ name: 'Invitation', value: 'Indéterminée', inline: true });
    }

    await sendInviteLog(member.guild, inviteEmbed);
  },
};
