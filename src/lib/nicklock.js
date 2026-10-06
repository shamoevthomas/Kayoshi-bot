// Pseudos verrouillés (/lockpseudo) : le membre ne peut plus changer son pseudo
// sur le serveur (il est remis aussitôt). Le staff (permission « Gérer les
// pseudos ») peut toujours le changer : son choix devient le pseudo verrouillé.
import { AuditLogEvent, PermissionFlagsBits } from 'discord.js';
import { getNickLock, getNickLocks, setNickLock } from './store.js';

const REASON = 'Pseudo verrouillé (/lockpseudo)';

// Auteur du changement de pseudo, via le journal d'audit. On exige que l'entrée
// porte bien le pseudo actuel : évite de reprendre une ancienne entrée (ex : la
// remise du bot) si le journal n'est pas encore à jour.
async function findNickExecutor(member) {
  const logs = await member.guild.fetchAuditLogs({ type: AuditLogEvent.MemberUpdate, limit: 10 }).catch(() => null);
  const entry = logs?.entries.find(
    (e) =>
      e.targetId === member.id &&
      Date.now() - e.createdTimestamp < 15_000 &&
      e.changes.some((c) => c.key === 'nick' && (c.new ?? null) === member.nickname),
  );
  return entry?.executor ?? null;
}

// Staff = le bot lui-même (/nick, /lockpseudo) ou un membre qui peut gérer les pseudos.
async function isStaff(guild, userId) {
  if (userId === guild.client.user.id) return true;
  const m = await guild.members.fetch(userId).catch(() => null);
  return Boolean(m?.permissions.has(PermissionFlagsBits.ManageNicknames));
}

// Remet le pseudo verrouillé (arrivée, démarrage). Renvoie true si changé.
export async function applyNickLock(member) {
  const lock = getNickLock(member.guild.id, member.id);
  if (!lock || member.nickname === lock.nick) return false;
  return member
    .setNickname(lock.nick, REASON)
    .then(() => true)
    .catch(() => false);
}

// Appelé quand le pseudo d'un membre change : remet le pseudo verrouillé, sauf
// si le changement vient du staff (le nouveau pseudo est alors verrouillé).
export async function enforceNickLock(member) {
  const lock = getNickLock(member.guild.id, member.id);
  if (!lock || member.nickname === lock.nick) return false;
  const executor = await findNickExecutor(member);
  if (executor && (await isStaff(member.guild, executor.id))) {
    setNickLock(member.guild.id, member.id, { ...lock, nick: member.nickname, by: executor.id, at: Date.now() });
    return false;
  }
  return applyNickLock(member);
}

// Rattrapage au démarrage (pseudos changés pendant que le bot était hors ligne).
export async function sweepNickLocks(client) {
  for (const [, guild] of client.guilds.cache) {
    for (const userId of Object.keys(getNickLocks(guild.id))) {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (member) await applyNickLock(member);
    }
  }
}
