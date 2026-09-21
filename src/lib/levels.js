// Système de niveaux (XP).
// - Gain automatique à chaque message, selon la longueur du message.
// - Courbe : niveau 1 = 100 XP, puis +40 XP par niveau (nv2 = +140, nv3 = +180…).
//   => XP cumulée pour ATTEINDRE le niveau n : 20n² + 80n.
import { addXp, levelUpChannelId, getLevelRewards } from './store.js';

// Anti-farm : un membre ne gagne de l'XP qu'une fois toutes les 5 secondes.
// État en mémoire (le cooldown est trop court pour justifier une persistance).
const XP_COOLDOWN_MS = 5000;
const lastGain = new Map(); // `${guildId}:${userId}` -> timestamp du dernier gain

// XP gagnée pour un message selon sa longueur (caractères, espaces de bord retirés).
export function xpForMessage(len) {
  if (len >= 120) return 60;
  if (len >= 60) return 30;
  if (len >= 30) return 20;
  if (len >= 6) return 10;
  return 0;
}

// XP cumulée nécessaire pour atteindre le niveau n (n=0 → 0).
export function xpForLevel(n) {
  const lvl = Math.max(0, Math.floor(n));
  return 20 * lvl * lvl + 80 * lvl;
}

// Niveau atteint pour une XP totale donnée.
export function levelFromXp(xp) {
  if (xp < 100) return 0;
  return Math.floor((-80 + Math.sqrt(6400 + 80 * xp)) / 40);
}

// Détail de progression (pour /niveau).
export function levelInfo(xp) {
  const level = levelFromXp(xp);
  const floor = xpForLevel(level);
  const ceil = xpForLevel(level + 1);
  return {
    level,
    xp,
    into: xp - floor, // XP acquise dans le niveau courant
    span: ceil - floor, // XP totale du niveau courant
    toNext: ceil - xp, // XP restante avant le niveau suivant
  };
}

// XP à ajouter (signée) pour faire varier le niveau d'un membre de `deltaLevels`
// à partir de son niveau actuel, en conservant sa progression dans le niveau.
export function xpDeltaForLevels(currentXp, deltaLevels) {
  const lvl = levelFromXp(currentXp);
  const target = Math.max(0, lvl + deltaLevels);
  return xpForLevel(target) - xpForLevel(lvl);
}

// À chaque message : crédite l'XP correspondante et annonce un éventuel level-up.
export async function grantMessageXp(message) {
  if (!message.guild || message.author?.bot) return;
  const gain = xpForMessage((message.content ?? '').trim().length);
  if (!gain) return;

  // Anti-farm : ignore si le dernier gain remonte à moins de 5 secondes.
  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  if (now - (lastGain.get(key) ?? 0) < XP_COOLDOWN_MS) return;
  lastGain.set(key, now);

  const { before, after } = addXp(message.guild.id, message.author.id, gain);
  const oldLevel = levelFromXp(before);
  const newLevel = levelFromXp(after);
  if (newLevel !== oldLevel) {
    const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
    if (member) await syncLevelRoles(member, newLevel).catch(() => {});
  }
  if (newLevel > oldLevel) await announceLevelUp(message, newLevel).catch(() => {});
}

// Aligne les rôles-récompenses d'un membre sur son niveau : il porte tous les
// rôles des paliers qu'il a atteints (cumulatif), et perd ceux d'un palier
// au-dessus de son niveau (utile après un retrait d'XP/niveaux).
export async function syncLevelRoles(member, level = levelFromXp(0)) {
  const rewards = getLevelRewards(member.guild.id); // { niveau: roleId }
  for (const [lvlStr, roleId] of Object.entries(rewards)) {
    const lvl = Number(lvlStr);
    const has = member.roles.cache.has(roleId);
    if (level >= lvl && !has) await member.roles.add(roleId, `Récompense de niveau ${lvl}`).catch(() => {});
    else if (level < lvl && has) await member.roles.remove(roleId, `Niveau ${lvl} non atteint`).catch(() => {});
  }
}

// Annonce de passage de niveau : dans le salon dédié si configuré, sinon dans
// le salon où le membre a écrit.
async function announceLevelUp(message, level) {
  const dedicatedId = levelUpChannelId(message.guild.id);
  let channel = message.channel;
  if (dedicatedId) {
    channel =
      message.guild.channels.cache.get(dedicatedId) ??
      (await message.guild.channels.fetch(dedicatedId).catch(() => null));
    if (!channel?.isTextBased()) return;
  }
  await channel.send({
    content: `🎉 ${message.author}, tu passes **niveau ${level}** !`,
    allowedMentions: { users: [message.author.id] },
  });
}
