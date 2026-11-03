import { AuditLogEvent } from 'discord.js';
import { getGuildConfig, setGuildConfig, getLeftRoles, setLeftRoles } from './store.js';

// Rôles d'un membre au moment où il quitte le serveur (events/guildMemberRemove.js), montrés par /userinfo et dans
// le journal de départ. Renvoie la liste [[id, nom], …], ou null si le membre n'était pas en cache.
export function rememberLeftRoles(member) {
  if (member.partial) return null; // rôles inconnus : on garde ce qui était noté
  const roles = member.roles.cache
    .filter((r) => r.id !== member.guild.id && !r.managed)
    .sort((a, b) => b.position - a.position)
    .map((r) => [r.id, r.name]);
  setLeftRoles(member.guild.id, member.id, { at: Date.now(), roles });
  return roles;
}

// Rôles notés, en mentions (barrés s'ils ont été supprimés depuis), dans la limite d'un champ d'embed.
export function rolesText(guild, roles) {
  if (!roles.length) return 'Aucun';
  let text = '';
  for (const [i, [id, name]] of roles.entries()) {
    const part = guild.roles.cache.has(id) ? `<@&${id}>` : `~~${name}~~`;
    if (text.length + part.length > 1000) return `${text} … et ${roles.length - i} autre(s)`;
    text += (text ? ' ' : '') + part;
  }
  return text;
}

// Départs d'avant cet enregistrement : rôles retrouvés une fois pour toutes dans le journal d'audit (45 jours au plus),
// en rejouant les ajouts et retraits de rôles de chaque membre entre sa dernière arrivée et son dernier départ.
export async function backfillLeftRoles(guild) {
  const cfg = getGuildConfig(guild.id);
  if (cfg.leftRolesBackfill) return;
  const stays = new Map(); // membre → dernier séjour terminé par un départ { from, to }
  const lastJoin = new Map();
  for (const e of cfg.memberEvents ?? []) {
    if (e.t === 'join') lastJoin.set(e.u, e.ts);
    else if (e.t === 'leave') stays.set(e.u, { from: lastJoin.get(e.u) ?? 0, to: e.ts });
  }
  for (const id of stays.keys()) if (getLeftRoles(guild.id, id)) stays.delete(id);
  if (!stays.size) return void setGuildConfig(guild.id, { leftRolesBackfill: Date.now() });

  const changes = new Map(); // membre → [[moment, '$add' | '$remove', [{ id, name }]]]
  const oldestFrom = Math.min(...[...stays.values()].map((s) => s.from));
  let before;
  let complete = false;
  for (let page = 0; page < 300; page++) {
    const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberRoleUpdate, limit: 100, before });
    for (const entry of logs.entries.values()) {
      const stay = stays.get(entry.targetId);
      if (!stay || entry.createdTimestamp <= stay.from || entry.createdTimestamp >= stay.to) continue;
      const list = changes.get(entry.targetId) ?? [];
      for (const c of entry.changes) if (c.key === '$add' || c.key === '$remove') list.push([entry.createdTimestamp, c.key, c.new ?? []]);
      changes.set(entry.targetId, list);
    }
    // Fin du journal, ou plus ancien que toutes les arrivées concernées : tout est lu.
    if (logs.entries.size < 100 || logs.entries.last().createdTimestamp < oldestFrom) {
      complete = true;
      break;
    }
    before = logs.entries.last().id;
  }
  if (!complete) return; // journal trop long : on réessaiera au prochain démarrage

  for (const [id, stay] of stays) {
    const held = new Map();
    for (const [, key, roles] of (changes.get(id) ?? []).sort((a, b) => a[0] - b[0])) {
      for (const r of roles) key === '$add' ? held.set(r.id, r.name) : held.delete(r.id);
    }
    const position = (rid) => guild.roles.cache.get(rid)?.position ?? -1;
    const roles = [...held].filter(([rid]) => !guild.roles.cache.get(rid)?.managed).sort((a, b) => position(b[0]) - position(a[0]));
    setLeftRoles(guild.id, id, { at: stay.to, roles, audit: true });
  }
  setGuildConfig(guild.id, { leftRolesBackfill: Date.now() });
  console.log(`[anciens rôles] ${guild.name} : rôles retrouvés pour ${stays.size} départ(s) d’avant leur enregistrement.`);
}
