// Jail (/jail) : le membre perd un rôle et gagne le rôle de jail jusqu'au /unjail.
// Tant qu'il est jail, le rôle retiré ne peut pas lui être redonné (ex : par la
// vérification à son retour), et il retrouve le rôle de jail s'il quitte et revient.
import { PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { getJailConfig, getJailRecord, setJailRecord, removeJailRecord, getTicketConfig } from './store.js';
import { sendSanctionLog, Colors } from './logger.js';

const REASON = 'Membre jail (/jail)';

// Vérifie que le bot peut donner/retirer ce rôle. Renvoie un message d'erreur ou null.
export function jailRoleProblem(guild, role) {
  if (!role) return '❌ Un des rôles configurés n’existe plus. Relance `/jailconfig`.';
  if (role.id === guild.id) return '❌ Impossible d’utiliser @everyone.';
  if (role.managed) return `❌ Le rôle ${role} est géré par une intégration, je ne peux pas le donner ni le retirer.`;
  const me = guild.members.me;
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) return '❌ Il me manque la permission **Gérer les rôles**.';
  if (role.position >= me.roles.highest.position) {
    return `❌ Le rôle ${role} est au-dessus de mon rôle le plus haut. Déplace mon rôle plus haut.`;
  }
  return null;
}

// Jail un membre avec les rôles de /jailconfig, poste le log de sanction et le
// mentionne dans le salon du 1er système de tickets.
// `by` = l'utilisateur à l'origine du jail (le bot pour un jail automatique).
// Renvoie { addRole, removeRole, hadRole, ticketChannel }, ou { error } avec un message prêt à afficher.
export async function jailMember(member, { by, reason = null }) {
  const guild = member.guild;
  const config = getJailConfig(guild.id);
  if (!config) return { error: '❌ Le jail n’est pas configuré. Lance d’abord `/jailconfig`.' };

  const addRole = guild.roles.cache.get(config.addRoleId);
  const removeRole = guild.roles.cache.get(config.removeRoleId);
  const problem = jailRoleProblem(guild, addRole) ?? jailRoleProblem(guild, removeRole);
  if (problem) return { error: problem };

  // Enregistré AVANT les changements de rôles : le rôle retiré ne peut plus revenir.
  const hadRole = member.roles.cache.has(removeRole.id);
  setJailRecord(guild.id, member.id, {
    addRoleId: addRole.id,
    removeRoleId: removeRole.id,
    hadRole,
    by: by.id,
    at: Date.now(),
    reason,
  });
  const auditReason = `Jail par ${by.tag}${reason ? ` : ${reason}` : ''}`;
  try {
    await member.roles.add(addRole, auditReason);
    if (hadRole) await member.roles.remove(removeRole, auditReason);
  } catch (err) {
    removeJailRecord(guild.id, member.id);
    await member.roles.remove(addRole).catch(() => {});
    if (hadRole) await member.roles.add(removeRole).catch(() => {});
    return { error: `❌ Impossible de jail ce membre : ${err?.message ?? 'erreur inconnue'}` };
  }

  await sendSanctionLog(
    guild,
    new EmbedBuilder()
      .setColor(Colors.delete)
      .setAuthor({ name: '⛓️ Membre jail' })
      .setDescription(`${member.user} (${member.user.tag})`)
      .addFields(
        { name: 'Rôle retiré', value: hadRole ? `${removeRole}` : `${removeRole} (ne l’avait pas)`, inline: true },
        { name: 'Rôle donné', value: `${addRole}`, inline: true },
        { name: 'Raison', value: reason || 'Aucune raison précisée' },
        { name: 'Par', value: `${by}`, inline: true },
      )
      .setTimestamp(),
  );

  const ticketChannel = await mentionInTicketChannel(member);
  return { addRole, removeRole, hadRole, ticketChannel };
}

// Mentionne le membre jail dans le salon du panneau du 1er système de tickets,
// puis supprime la mention 3 s après. Renvoie le salon si la mention est partie, sinon null.
async function mentionInTicketChannel(member) {
  const channelId = getTicketConfig(member.guild.id, 'ticketConfig')?.panelChannelId;
  if (!channelId) return null;
  const channel =
    member.guild.channels.cache.get(channelId) ?? (await member.guild.channels.fetch(channelId).catch(() => null));
  if (!channel?.isTextBased()) return null;
  const sent = await channel.send({ content: `${member}`, allowedMentions: { users: [member.id] } }).catch((err) => {
    console.error('[jail] mention dans le salon des tickets impossible :', err.message);
    return null;
  });
  if (!sent) return null;
  // Supprimée 3 s après : le membre garde la notification, le salon reste propre.
  setTimeout(() => sent.delete().catch(() => {}), 3000);
  return channel;
}

// À l'arrivée : remet le rôle de jail si le membre était jail avant de partir.
export async function restoreJailOnJoin(member) {
  const rec = getJailRecord(member.guild.id, member.id);
  if (!rec) return;
  await member.roles.add(rec.addRoleId, REASON).catch(() => {});
}

// Changement de rôles d'un membre jail : le rôle retiré lui est enlevé s'il le
// récupère. Si le rôle de jail lui est retiré à la main, il est libéré.
export async function enforceJail(oldMember, newMember) {
  const rec = getJailRecord(newMember.guild.id, newMember.id);
  if (!rec) return;
  if (oldMember.roles.cache.has(rec.addRoleId) && !newMember.roles.cache.has(rec.addRoleId)) {
    removeJailRecord(newMember.guild.id, newMember.id);
    return;
  }
  if (newMember.roles.cache.has(rec.removeRoleId)) await newMember.roles.remove(rec.removeRoleId, REASON).catch(() => {});
}
