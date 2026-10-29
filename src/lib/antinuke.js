import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getGuildConfig, setGuildConfig } from './store.js';
import { sendLog } from './logger.js';

// Anti-nuke (/antinuke) : si quelqu'un supprime ou crée en masse (salons, rôles), ou bannit / expulse en
// masse, en moins d'une minute, le bot lui retire tous ses rôles (un bot est expulsé), puis prévient le
// propriétaire en MP et dans les logs. Ne sont jamais visés : le propriétaire du serveur, le bot lui-même
// et les membres de confiance. Actif par défaut ; réglages : data[guildId].antinuke = { enabled, trusted: [ids] }.
// Les actions sont lues dans le journal d'audit (événements channelDelete, roleDelete, guildBanAdd…).
const WINDOW_MS = 60_000;
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

const isExempt = (guild, userId) => userId === guild.ownerId || userId === guild.client.user.id || getAntiNuke(guild.id).trusted.includes(userId);

// Une action destructrice de `executor` (utilisateur du journal d'audit). Sanctionne au-delà de la limite.
export async function noteAction(guild, executor, kind) {
  if (!guild || !executor || !LIMITS[kind] || !getAntiNuke(guild.id).enabled || isExempt(guild, executor.id)) return;
  const key = `${guild.id}:${executor.id}:${kind}`;
  const now = Date.now();
  const recent = (actions.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  actions.set(key, recent);
  if (recent.length < LIMITS[kind].max) return;
  const who = `${guild.id}:${executor.id}`;
  if (now - (punished.get(who) ?? 0) < PUNISHED_MS) return;
  punished.set(who, now);
  await punish(guild, executor, kind, recent.length).catch((err) => console.error('[anti-nuke]', err));
}

async function punish(guild, executor, kind, count) {
  const member = await guild.members.fetch(executor.id).catch(() => null);
  const reason = `Anti-nuke : ${count} ${LIMITS[kind].label} en moins d’une minute`;
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
    .setTitle('🚨 Anti-nuke déclenché')
    .setDescription(
      `${executor} (\`${executor.tag ?? executor.username}\`) : **${count} ${LIMITS[kind].label}** en moins d’une minute.\n\n` +
        `➡️ Sanction : ${outcome}.\n\n` +
        '-# Pour recréer ce qui a été supprimé : `/backup restaurer`. Pour éviter qu’un membre de confiance soit visé : `/antinuke ajouter`.',
    )
    .setTimestamp();
  await sendLog(guild, embed);
  const owner = await guild.fetchOwner().catch(() => null);
  await owner?.send({ content: `Sur **${guild.name}** :`, embeds: [embed] }).catch(() => {});
}

// Membres qui ont la permission d'agir en masse (pour le message de /antinuke voir).
export const DANGEROUS = [PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.BanMembers, PermissionFlagsBits.KickMembers];
