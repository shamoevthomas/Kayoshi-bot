import { getInviteRanks } from './store.js';

// Met à jour le rôle de palier d'un membre selon son total d'invitations.
// « Évolue » : le membre ne conserve QUE le rôle du palier le plus élevé atteint ;
// les rôles des paliers inférieurs sont retirés automatiquement.
// Renvoie le palier nouvellement obtenu ({ count, roleId }) ou null si aucun changement.
export async function syncInviteRankRole(guild, userId, total) {
  const ranks = getInviteRanks(guild.id);
  if (!ranks.length) return null;

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member || member.user.bot) return null;

  const sorted = [...ranks].sort((a, b) => a.count - b.count);
  // Palier le plus élevé dont le seuil est atteint.
  const earned = [...sorted].reverse().find((r) => total >= r.count) ?? null;

  // Retire les rôles de palier que le membre ne devrait plus avoir.
  const toRemove = sorted
    .map((r) => r.roleId)
    .filter((roleId, i, arr) => arr.indexOf(roleId) === i) // uniques
    .filter((roleId) => roleId !== earned?.roleId && member.roles.cache.has(roleId));

  let promoted = false;
  if (earned && !member.roles.cache.has(earned.roleId)) {
    await member.roles.add(earned.roleId).catch(() => {});
    promoted = true;
  }
  if (toRemove.length) await member.roles.remove(toRemove).catch(() => {});

  return promoted ? earned : null;
}
