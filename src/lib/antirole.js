// Rôles incompatibles (/antirole) : si un membre a le rôle « gardé » d'une
// règle, le rôle « retiré » lui est enlevé (ex : Actif + Nouveau → Nouveau retiré).
import { getAntiRoleRules } from './store.js';

// true si ce rôle ne peut pas être porté par ce membre (bloqué par une règle).
// Utilisé par les rôles automatiques pour ne pas le redonner en boucle.
export function isBlockedByAntiRole(member, roleId) {
  return getAntiRoleRules(member.guild.id).some(
    (r) => r.removeRoleId === roleId && member.roles.cache.has(r.keepRoleId),
  );
}

// Retire au membre les rôles incompatibles. Renvoie le nombre de rôles retirés.
export async function enforceAntiRoles(member) {
  if (!member || member.user?.bot) return 0;
  const rules = getAntiRoleRules(member.guild.id).filter(
    (r) => member.roles.cache.has(r.keepRoleId) && member.roles.cache.has(r.removeRoleId),
  );
  let removed = 0;
  for (const roleId of new Set(rules.map((r) => r.removeRoleId))) {
    const keep = rules.find((r) => r.removeRoleId === roleId);
    const keepName = member.guild.roles.cache.get(keep.keepRoleId)?.name ?? keep.keepRoleId;
    const ok = await member.roles
      .remove(roleId, `Antirole : incompatible avec le rôle ${keepName}`)
      .then(() => true)
      .catch(() => false);
    if (ok) removed += 1;
  }
  return removed;
}

// Applique les règles à tous les membres d'un serveur. Renvoie le nombre de rôles retirés.
export async function sweepAntiRolesGuild(guild) {
  if (!getAntiRoleRules(guild.id).length) return 0;
  const members = await guild.members.fetch().catch(() => guild.members.cache);
  let removed = 0;
  for (const [, member] of members) removed += await enforceAntiRoles(member).catch(() => 0);
  return removed;
}

// Rattrapage au démarrage (changements de rôles pendant que le bot était hors ligne).
export async function sweepAntiRoles(client) {
  for (const [, guild] of client.guilds.cache) await sweepAntiRolesGuild(guild).catch(() => {});
}
