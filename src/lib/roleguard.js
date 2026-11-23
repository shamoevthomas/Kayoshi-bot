import { AuditLogEvent, EmbedBuilder, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { sendLog } from './logger.js';
import { getAntiNuke, isTrusted } from './antinuke.js';

// Garde des rôles (fait partie de l'anti-nuke, /config → Anti-nuke) : un rôle créé avec des permissions de staff est
// supprimé, et un rôle modifié pour en recevoir les perd aussitôt (les autres changements restent). C'est par là que
// commence un nuke : un membre se donne Bannir / Expulser / Gérer les rôles… Ne sont jamais visés : le propriétaire,
// 50.nn et l0un4tik (serveurs de laysox_off), les membres de confiance de l'anti-nuke et le bot (/backup restaurer).
// Les rôles gérés par une intégration (rôle d'un bot) ne peuvent être ni supprimés ni modifiés : l'anti-bot s'en charge.
export const GUARDED = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.ManageGuildExpressions,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageEvents,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.MentionEveryone,
];
const GUARDED_BITS = new PermissionsBitField(GUARDED).bitfield;
const LABELS = {
  Administrator: 'Administrateur',
  ManageGuild: 'Gérer le serveur',
  ManageRoles: 'Gérer les rôles',
  ManageChannels: 'Gérer les salons',
  ManageWebhooks: 'Gérer les webhooks',
  ManageGuildExpressions: 'Gérer les expressions',
  ManageMessages: 'Gérer les messages',
  ManageEvents: 'Gérer les événements',
  BanMembers: 'Bannir',
  KickMembers: 'Expulser',
  ModerateMembers: 'Exclure temporairement',
  MentionEveryone: 'Mentionner @everyone',
};
const labels = (bits) => new PermissionsBitField(bits).toArray().map((p) => LABELS[p] ?? p).join(', ');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Auteur dans le journal d'audit (l'entrée peut arriver une ou deux secondes après l'événement).
async function auditExecutor(guild, type, roleId) {
  for (let i = 0; i < 3; i++) {
    const logs = await guild.fetchAuditLogs({ type, limit: 5 }).catch(() => null);
    const entry = logs?.entries.find((e) => e.targetId === roleId && Date.now() - e.createdTimestamp < 15_000);
    if (entry) return entry.executor ?? null;
    await sleep(1000);
  }
  return null;
}

async function report(guild, executor, title, text) {
  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle(title)
    .setDescription(`${text}\n\nPar ${executor ? `${executor} (\`${executor.tag ?? executor.username}\`)` : 'un membre inconnu'}.`)
    .setFooter({ text: 'Anti-nuke : seuls le propriétaire et les membres de confiance peuvent donner des permissions de staff à un rôle.' })
    .setTimestamp();
  await sendLog(guild, embed);
  const owner = await guild.fetchOwner().catch(() => null);
  await owner?.send({ content: `Sur **${guild.name}** :`, embeds: [embed] }).catch(() => {});
}

const watched = (guild) => getAntiNuke(guild.id).enabled;

// roleCreate : rôle créé avec des permissions de staff → supprimé.
export async function guardRoleCreate(role) {
  const { guild } = role;
  const risky = role.permissions.bitfield & GUARDED_BITS;
  if (!risky || role.managed || !watched(guild)) return false;
  const executor = await auditExecutor(guild, AuditLogEvent.RoleCreate, role.id);
  if (!executor || isTrusted(guild, executor.id)) return false;
  const deleted = await role
    .delete(`Anti-nuke : rôle créé avec des permissions de staff par ${executor.tag ?? executor.id}`)
    .then(() => true)
    .catch(() => false);
  await report(
    guild,
    executor,
    '🛡️ Rôle avec permissions supprimé',
    `Le rôle **${role.name}** a été créé avec : **${labels(risky)}**.\n➡️ ${deleted ? 'Rôle **supprimé**.' : '⚠️ Je n’ai pas pu le supprimer (mon rôle doit être tout en haut).'}`,
  );
  return true;
}

// roleUpdate : permissions de staff ajoutées à un rôle → retirées (le reste de la modification est gardé).
export async function guardRoleUpdate(oldRole, newRole) {
  const { guild } = newRole;
  const added = newRole.permissions.bitfield & ~oldRole.permissions.bitfield & GUARDED_BITS;
  if (!added || newRole.managed || !watched(guild)) return false;
  const executor = await auditExecutor(guild, AuditLogEvent.RoleUpdate, newRole.id);
  if (!executor || isTrusted(guild, executor.id)) return false;
  const reverted = await newRole
    .setPermissions(newRole.permissions.bitfield & ~added, `Anti-nuke : permissions de staff ajoutées par ${executor.tag ?? executor.id}`)
    .then(() => true)
    .catch(() => false);
  await report(
    guild,
    executor,
    '🛡️ Permissions de staff retirées',
    `Le rôle ${newRole} a reçu : **${labels(added)}**.\n➡️ ${reverted ? 'Ces permissions ont été **retirées**.' : '⚠️ Je n’ai pas pu les retirer (mon rôle doit être au-dessus de celui-ci).'}`,
  );
  return true;
}
