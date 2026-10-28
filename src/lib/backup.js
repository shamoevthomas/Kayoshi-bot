import { AttachmentBuilder, ChannelType, PermissionFlagsBits } from 'discord.js';
import { loadBackups, saveBackups } from './store.js';

// Sauvegardes du serveur (/backup) : rôles (nom, couleur, permissions…), catégories et salons (sujet,
// slowmode, limite vocale…) avec leurs permissions. Pas les messages ni les membres.
// Une sauvegarde automatique par jour (les 3 dernières gardées) + jusqu'à 5 sauvegardes manuelles.
// La restauration ne supprime ni ne modifie rien : elle recrée seulement ce qui manque (après un raid,
// une erreur…). Sur le même serveur, un élément est retrouvé par son identifiant ; sur un autre serveur,
// par son nom.
const MAX_MANUAL = 5;
const MAX_AUTO = 3;
export const AUTO_EVERY_MS = 24 * 3_600_000;
const SAVED_TYPES = new Set([
  ChannelType.GuildCategory,
  ChannelType.GuildText,
  ChannelType.GuildVoice,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildStageVoice,
  ChannelType.GuildForum,
]);
// Si un type demande une fonction que le serveur n'a pas (communauté), on retombe sur texte ou vocal.
const FALLBACK = {
  [ChannelType.GuildAnnouncement]: ChannelType.GuildText,
  [ChannelType.GuildForum]: ChannelType.GuildText,
  [ChannelType.GuildStageVoice]: ChannelType.GuildVoice,
};

export function snapshot(guild, auto = false) {
  const roles = [...guild.roles.cache.values()]
    .filter((r) => r.id !== guild.id && !r.managed)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({ id: r.id, name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable, permissions: r.permissions.bitfield.toString(), position: r.position }));
  const channels = [...guild.channels.cache.values()]
    .filter((c) => SAVED_TYPES.has(c.type))
    .sort((a, b) => (a.type === ChannelType.GuildCategory ? 0 : 1) - (b.type === ChannelType.GuildCategory ? 0 : 1) || a.rawPosition - b.rawPosition)
    .map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      parentId: c.parentId ?? null,
      position: c.rawPosition,
      topic: c.topic ?? null,
      nsfw: c.nsfw ?? false,
      slowmode: c.rateLimitPerUser ?? 0,
      bitrate: c.bitrate ?? null,
      userLimit: c.userLimit ?? null,
      overwrites: [...c.permissionOverwrites.cache.values()].map((o) => ({ id: o.id, type: o.type, allow: o.allow.bitfield.toString(), deny: o.deny.bitfield.toString() })),
    }));
  return {
    id: Date.now().toString(36),
    auto,
    createdAt: Date.now(),
    guildId: guild.id,
    guildName: guild.name,
    everyone: guild.roles.everyone.permissions.bitfield.toString(),
    roles,
    channels,
  };
}

// Enregistre une sauvegarde (en gardant les plus récentes de chaque sorte). Renvoie la sauvegarde.
export async function createBackup(guild, auto = false) {
  const backup = snapshot(guild, auto);
  const list = [backup, ...(await loadBackups(guild.id))];
  const kept = [...list.filter((b) => !b.auto).slice(0, MAX_MANUAL), ...list.filter((b) => b.auto).slice(0, MAX_AUTO)].sort((a, b) => b.createdAt - a.createdAt);
  await saveBackups(guild.id, kept);
  return backup;
}

// Sauvegarde automatique quotidienne de chaque serveur (vérifiée toutes les heures).
export async function autoBackups(client) {
  for (const guild of client.guilds.cache.values()) {
    const last = (await loadBackups(guild.id).catch(() => [])).find((b) => b.auto);
    if (last && Date.now() - last.createdAt < AUTO_EVERY_MS) continue;
    await createBackup(guild, true).catch((err) => console.error('[backup]', err.message));
  }
}

export const describe = (b) =>
  `${b.auto ? '🕒 auto' : '💾 manuelle'} du <t:${Math.floor(b.createdAt / 1000)}:f> — ${b.roles.length} rôles, ${b.channels.length} salons`;

export function backupFile(b) {
  const date = new Date(b.createdAt).toISOString().slice(0, 10);
  return new AttachmentBuilder(Buffer.from(JSON.stringify(b, null, 1)), { name: `backup-${b.guildName.replace(/[^\w-]+/g, '_')}-${date}.json` });
}

// Lit un fichier de sauvegarde envoyé par un membre. Renvoie la sauvegarde, ou null.
export async function readBackupFile(attachment) {
  if (!attachment || attachment.size > 8 * 1024 * 1024) return null;
  try {
    const b = await (await fetch(attachment.url)).json();
    return Array.isArray(b?.roles) && Array.isArray(b?.channels) && b.guildId ? b : null;
  } catch {
    return null;
  }
}

// Un élément est retrouvé par son identifiant (même serveur), sinon par son nom : un élément déjà
// recréé par une restauration précédente a un nouvel identifiant, il ne doit pas être recréé en double.
const findRole = (guild, backup, r) =>
  (backup.guildId === guild.id && guild.roles.cache.get(r.id)) || guild.roles.cache.find((x) => x.name === r.name && !x.managed);
const findChannel = (guild, backup, c, parent) =>
  (backup.guildId === guild.id && guild.channels.cache.get(c.id)) ||
  guild.channels.cache.find((x) => x.name === c.name && (x.type === c.type || x.type === FALLBACK[c.type]) && (c.type === ChannelType.GuildCategory || (x.parentId ?? null) === parent));

// Ce qu'une restauration recréerait (aperçu avant confirmation).
export function missingCount(guild, backup) {
  const roles = backup.roles.filter((r) => !findRole(guild, backup, r)).length;
  const channelMap = new Map();
  let channels = 0;
  for (const c of backup.channels) {
    const found = findChannel(guild, backup, c, c.parentId ? (channelMap.get(c.parentId) ?? null) : null);
    if (found) channelMap.set(c.id, found.id);
    else channels++;
  }
  return { roles, channels };
}

// Recrée ce qui manque. onProgress(stats) est appelé de temps en temps. Renvoie les stats.
export async function restoreBackup(guild, backup, onProgress = () => {}) {
  const me = guild.members.me;
  const admin = me.permissions.has(PermissionFlagsBits.Administrator);
  const stats = { roles: 0, channels: 0, kept: 0, errors: [] };
  const reason = `Restauration de la sauvegarde du ${new Date(backup.createdAt).toLocaleDateString('fr-FR')}`;

  // Rôles : du plus haut au plus bas. Un rôle créé arrive tout en bas, l'ordre entre eux est donc gardé.
  const roleMap = new Map([[backup.guildId, guild.id]]);
  for (const r of backup.roles) {
    const found = findRole(guild, backup, r);
    if (found) {
      roleMap.set(r.id, found.id);
      stats.kept++;
      continue;
    }
    // Le bot ne peut pas donner une permission qu'il n'a pas.
    const permissions = admin ? BigInt(r.permissions) : BigInt(r.permissions) & me.permissions.bitfield;
    const created = await guild.roles
      .create({ name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable, permissions, reason })
      .catch((err) => void stats.errors.push(`rôle « ${r.name} » : ${err.message}`));
    if (created) {
      roleMap.set(r.id, created.id);
      stats.roles++;
      await onProgress(stats);
    }
  }

  // Permissions d'un salon : les rôles retrouvés ou recréés, et les membres encore présents.
  await guild.members.fetch().catch(() => {});
  const overwrites = (list) =>
    list
      .map((o) => {
        const id = o.type === 0 ? roleMap.get(o.id) : guild.members.cache.has(o.id) ? o.id : null;
        return id ? { id, type: o.type, allow: BigInt(o.allow), deny: BigInt(o.deny) } : null;
      })
      .filter(Boolean);

  // Catégories d'abord (elles sont en tête de la sauvegarde), puis les salons dedans.
  const channelMap = new Map();
  for (const c of backup.channels) {
    const parent = c.parentId ? (channelMap.get(c.parentId) ?? null) : null;
    const found = findChannel(guild, backup, c, parent);
    if (found) {
      channelMap.set(c.id, found.id);
      stats.kept++;
      continue;
    }
    const options = {
      name: c.name,
      type: c.type,
      parent,
      topic: c.topic ?? undefined,
      nsfw: c.nsfw,
      rateLimitPerUser: c.slowmode || undefined,
      bitrate: c.bitrate ? Math.min(c.bitrate, guild.maximumBitrate ?? 96_000) : undefined,
      userLimit: c.userLimit || undefined,
      permissionOverwrites: overwrites(c.overwrites),
      position: c.position,
      reason,
    };
    let created = await guild.channels.create(options).catch(() => null);
    // Type non disponible sur ce serveur, ou permissions refusées : on réessaie plus simplement.
    if (!created && FALLBACK[c.type] !== undefined) created = await guild.channels.create({ ...options, type: FALLBACK[c.type] }).catch(() => null);
    if (!created) {
      created = await guild.channels
        .create({ ...options, type: FALLBACK[c.type] ?? c.type, permissionOverwrites: [] })
        .catch((err) => void stats.errors.push(`salon « ${c.name} » : ${err.message}`));
      if (created) stats.errors.push(`salon « ${c.name} » recréé sans ses permissions (il m’en manque pour les copier)`);
    }
    if (created) {
      channelMap.set(c.id, created.id);
      stats.channels++;
      await onProgress(stats);
    }
  }
  return stats;
}
