// Réconciliation UNIFIÉE des rôles automatiques (statut mots-clés, statut-role,
// tag du serveur). On calcule l'ensemble des rôles « voulus » toutes sources
// confondues, et on ne retire un rôle QUE si aucune source ne le réclame.
// -> Fini les conflits où un système enlève le rôle qu'un autre vient de mettre.
import { getStatutRules, getStatusRoleConfig, getTagRoleConfig } from './store.js';
import { wearsServerTag } from './tagrole.js';

function presenceText(member) {
  const parts = [];
  for (const a of member?.presence?.activities ?? []) {
    if (a.state) parts.push(a.state);
    if (a.name) parts.push(a.name);
    if (a.details) parts.push(a.details);
  }
  return parts.join(' ').toLowerCase();
}

// Renvoie true si au moins une source de rôle auto est configurée sur le serveur.
export function hasAutoRoles(guildId) {
  return Boolean(
    getStatutRules(guildId).length || getStatusRoleConfig(guildId)?.roleId || getTagRoleConfig(guildId)?.roleId,
  );
}

export async function reconcileAutoRoles(member) {
  if (!member || member.user?.bot) return;
  const guildId = member.guild.id;
  const text = presenceText(member);

  const managed = new Set(); // rôles gérés par au moins une source
  const desired = new Set(); // rôles réclamés par au moins une source

  // 1) /statut (plusieurs mots-clés)
  for (const r of getStatutRules(guildId)) {
    if (!r.roleId) continue;
    managed.add(r.roleId);
    if (r.keyword && text.includes(r.keyword.toLowerCase())) desired.add(r.roleId);
  }
  // 2) /statut-role (mot-clé unique)
  const sr = getStatusRoleConfig(guildId);
  if (sr?.roleId && sr.text) {
    managed.add(sr.roleId);
    if (text.includes(sr.text.toLowerCase())) desired.add(sr.roleId);
  }
  // 3) /tagrole (tag du serveur)
  const tr = getTagRoleConfig(guildId);
  if (tr?.roleId) {
    managed.add(tr.roleId);
    if (wearsServerTag(member)) desired.add(tr.roleId);
  }

  for (const roleId of managed) {
    const has = member.roles.cache.has(roleId);
    if (desired.has(roleId) && !has) await member.roles.add(roleId).catch(() => {});
    else if (!desired.has(roleId) && has) await member.roles.remove(roleId).catch(() => {});
  }
}

// Balaye un serveur (membres en cache).
export async function sweepAutoRolesGuild(guild) {
  for (const [, member] of guild.members.cache) await reconcileAutoRoles(member).catch(() => {});
}

// Balaye tous les serveurs concernés.
export async function sweepAutoRoles(client) {
  for (const [, guild] of client.guilds.cache) {
    if (hasAutoRoles(guild.id)) await sweepAutoRolesGuild(guild).catch(() => {});
  }
}
