// Persistance du rôle de quarantaine (ex-« blacklist »).
// Le rôle n'est plus attribué automatiquement (commandes supprimées), MAIS s'il
// a été donné à un membre, il le CONSERVE même s'il quitte et revient.
import { getServerBlacklist, addBlacklistSticky, removeBlacklistSticky, isBlacklistSticky } from './store.js';

function quarantineRoleId(guildId) {
  return getServerBlacklist(guildId).quarantineRoleId;
}

// À l'arrivée : si le membre était quarantiné avant de partir, on lui remet le rôle.
export async function restoreQuarantineOnJoin(member) {
  const roleId = quarantineRoleId(member.guild.id);
  if (!roleId || member.user.bot) return;
  if (!isBlacklistSticky(member.guild.id, member.id)) return;
  await member.roles.add(roleId, 'Rôle de quarantaine conservé après un re-join').catch(() => {});
}

// Au départ : si le membre a le rôle, on le retient pour le lui remettre au retour.
export function rememberQuarantineOnLeave(member) {
  const roleId = quarantineRoleId(member.guild.id);
  if (!roleId) return;
  if (member.roles?.cache?.has(roleId)) addBlacklistSticky(member.guild.id, member.id);
}

// Synchronise la mémoire quand un modo ajoute/retire le rôle manuellement
// (retirer le rôle libère le membre : il ne le récupérera plus au retour).
export function syncQuarantineRole(oldMember, newMember) {
  const roleId = quarantineRoleId(newMember.guild.id);
  if (!roleId) return;
  const had = oldMember.roles?.cache?.has(roleId);
  const has = newMember.roles?.cache?.has(roleId);
  if (has && !had) addBlacklistSticky(newMember.guild.id, newMember.id);
  else if (!has && had) removeBlacklistSticky(newMember.guild.id, newMember.id);
}
