import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getGuildConfig, setGuildConfig } from './store.js';
import { sendLog } from './logger.js';
import { getSecurity } from './securityconfig.js';

// Anti-nuke (/config → Anti-nuke) : si quelqu'un supprime ou crée en masse (salons, rôles), ou bannit / expulse en
// masse, en moins d'une minute, le bot lui retire tous ses rôles (un bot est expulsé), puis prévient le
// propriétaire en MP et dans les logs. Ne sont jamais visés : le propriétaire du serveur, le bot lui-même
// et les membres de confiance. Actif par défaut ; réglages : data[guildId].antinuke = { enabled, trusted: [ids] }.
// Les bans en masse suivent leur propre seuil (/config → Sécurité → Anti-Ban-Masse).
// Les actions sont lues dans le journal d'audit (événements channelDelete, roleDelete, guildBanAdd…).
const WINDOW_MS = 60_000;
// Toujours de confiance sur les serveurs de laysox_off : crown2ito et l0un4tik.
const DELEGATING_OWNER_ID = '1079335251551191061';
const ALWAYS_TRUSTED = ['1543615549974515763', '1260266494839754866'];
export const LIMITS = {
  channelDelete: { max: 3, label: 'salons supprimés' },
  roleDelete: { max: 3, label: 'rôles supprimés' },
  ban: { max: 4, label: 'membres bannis' },
  kick: { max: 5, label: 'membres expulsés' },
  channelCreate: { max: 8, label: 'salons créés' },
  roleCreate: { max: 8, label: 'rôles créés' },
};
const PUNISHED_MS = 5 * 60_000; // pas de deuxième sanction pour la même personne pendant 5 min

const actions = new Map(); // `${guildId}:${userId}:${kind}` → [instants]
const punished = new Map(); // `${guildId}:${userId}` → instant de la sanction

export function getAntiNuke(guildId) {
  const cfg = getGuildConfig(guildId).antinuke ?? {};
  return { enabled: cfg.enabled ?? true, trusted: cfg.trusted ?? [] };
}

export function setAntiNuke(guildId, patch) {
  setGuildConfig(guildId, { antinuke: { ...getAntiNuke(guildId), ...patch } });
}

// Jamais sanctionnés par les protections : le propriétaire, le bot, les membres de confiance (/config → Anti-nuke
// ajouter), et crown2ito et l0un4tik sur les serveurs de laysox_off.
export const isTrusted = (guild, userId) =>
  userId === guild.ownerId ||
  userId === guild.client.user.id ||
  getAntiNuke(guild.id).trusted.includes(userId) ||
  (guild.ownerId === DELEGATING_OWNER_ID && ALWAYS_TRUSTED.includes(userId));

const durationText = (ms) => (ms % 60_000 ? `${ms / 1000} s` : `${ms / 60_000} min`);

// Une action destructrice de `executor` (utilisateur du journal d'audit). Sanctionne au-delà de la limite.
export async function noteAction(guild, executor, kind) {
  if (!guild || !executor || !LIMITS[kind] || isTrusted(guild, executor.id)) return;
  const ban = kind === 'ban' ? getSecurity(guild.id, 'ban') : null;
  if (ban ? !ban.enabled : !getAntiNuke(guild.id).enabled) return;
  const max = ban?.max ?? LIMITS[kind].max;
  const windowMs = ban ? ban.seconds * 1000 : WINDOW_MS;
  const key = `${guild.id}:${executor.id}:${kind}`;
  const now = Date.now();
  const recent = (actions.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  actions.set(key, recent);
  if (recent.length < max) return;
  await sanctionStaff(guild, executor, {
    title: ban ? '🚨 Anti-ban de masse déclenché' : '🚨 Anti-nuke déclenché',
    what: `**${recent.length} ${LIMITS[kind].label}** en moins de ${durationText(windowMs)}`,
    reason: `${ban ? 'Anti-ban de masse' : 'Anti-nuke'} : ${recent.length} ${LIMITS[kind].label} en moins de ${durationText(windowMs)}`,
  }).catch((err) => console.error('[anti-nuke]', err));
}

// Sanction d'un membre qui abuse de ses permissions (anti-nuke, anti-bot, anti-déco…) : tous ses rôles retirés
// (un bot est expulsé), puis le propriétaire est prévenu en MP et dans les logs. Pas deux fois en 5 min.
export async function sanctionStaff(guild, executor, { title, what, reason }) {
  const who = `${guild.id}:${executor.id}`;
  if (Date.now() - (punished.get(who) ?? 0) < PUNISHED_MS) return false;
  punished.set(who, Date.now());
  const member = await guild.members.fetch(executor.id).catch(() => null);
  let outcome;
  if (!member) outcome = 'il n’est plus sur le serveur';
  else if (member.user.bot) {
    outcome = (await member.kick(reason).then(() => true).catch(() => false)) ? 'bot **expulsé**' : '⚠️ je n’ai pas pu expulser ce bot';
  } else {
    // Tous ses rôles retirés (sauf ceux gérés par une intégration, que personne ne peut retirer).
    const keep = member.roles.cache.filter((r) => r.managed && r.id !== guild.id);
    const removable = member.roles.cache.filter((r) => !r.managed && r.id !== guild.id);
    const tooHigh = removable.filter((r) => r.position >= guild.members.me.roles.highest.position);
    const ok = await member.roles.set([...keep.keys()], reason).then(() => true).catch(() => false);
    outcome = ok
      ? `**${removable.size}** rôle(s) retiré(s)`
      : `⚠️ je n’ai pas pu retirer ses rôles${tooHigh.size ? ' (certains sont au-dessus du mien : monte mon rôle tout en haut)' : ''}`;
  }

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle(title)
    .setDescription(
      `${executor} (\`${executor.tag ?? executor.username}\`) : ${what}.\n\n` +
        `➡️ Sanction : ${outcome}.\n\n` +
        '-# Pour recréer ce qui a été supprimé : `/backup restaurer`. Pour qu’un membre de confiance ne soit jamais visé : `/config → Anti-nuke → Ajouter un membre de confiance`.',
    )
    .setTimestamp();
  await sendLog(guild, embed);
  const owner = await guild.fetchOwner().catch(() => null);
  await owner?.send({ content: `Sur **${guild.name}** :`, embeds: [embed] }).catch(() => {});
  return true;
}

// Membres qui ont la permission d'agir en masse (pour le message de /config → Anti-nuke → Voir).
export const DANGEROUS = [PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.BanMembers, PermissionFlagsBits.KickMembers];
