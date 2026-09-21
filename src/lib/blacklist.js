// Persistance du rôle de quarantaine (ex-« blacklist »).
// Le rôle n'est plus attribué automatiquement (commandes supprimées), MAIS s'il
// a été donné à un membre, il le CONSERVE même s'il quitte et revient.
import { getServerBlacklist, addBlacklistSticky, removeBlacklistSticky, isBlacklistSticky } from './store.js';

function quarantineRoleId(guildId) {
  return getServerBlacklist(guildId).quarantineRoleId;
}

// À l'arrivée d'un membre :
//  - Serveur en mode blacklist (enabled) : TOUT nouvel arrivant est mis en
//    quarantaine — on lui ajoute le rôle « prisonnier » et on lui retire le
//    rôle « membre » (s'il est configuré).
//  - Sinon : on ne remet le rôle qu'à ceux qui l'avaient avant de partir
//    (persistance de la quarantaine à travers un re-join).
export async function applyQuarantineOnJoin(member) {
  const { quarantineRoleId: roleId, memberRoleId, enabled } = getServerBlacklist(member.guild.id);
  if (!roleId || member.user.bot) return;

  const shouldQuarantine = enabled || isBlacklistSticky(member.guild.id, member.id);
  if (!shouldQuarantine) return;

  await member.roles.add(roleId, 'Mise en quarantaine à l’arrivée').catch(() => {});
  if (memberRoleId) {
    await member.roles.remove(memberRoleId, 'Quarantaine : retrait du rôle membre').catch(() => {});
  }
  // Persistance : il reste prisonnier même s'il repart et revient, y compris si
  // le mode blacklist est désactivé entre-temps.
  addBlacklistSticky(member.guild.id, member.id);
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
