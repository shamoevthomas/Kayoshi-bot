// Jail (/jail) : le membre perd un rôle et gagne le rôle de jail jusqu'au /unjail.
// Tant qu'il est jail, le rôle retiré ne peut pas lui être redonné (ex : par la
// vérification à son retour), et il retrouve le rôle de jail s'il quitte et revient.
import { PermissionFlagsBits } from 'discord.js';
import { getJailRecord, removeJailRecord } from './store.js';

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
