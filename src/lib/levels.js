// Système de niveaux (XP).
// - Gain automatique à chaque message, selon la longueur du message.
// - Courbe : XP cumulée pour ATTEINDRE le niveau n = 20n² + 80n.
import { AttachmentBuilder } from 'discord.js';
import { createCanvas } from '@napi-rs/canvas';
import { font, fetchImage } from './fonts.js';
import { addXp, levelUpChannelId, getLevelRewards, getLevelUpMessage } from './store.js';

// Message texte par défaut au-dessus de la carte (modifiable via /configniveau).
const DEFAULT_LEVELUP = 'bien joué {user} tu viens de passer au niveau {level} !';

export function formatLevelUp(template, { user, level, guild }) {
  return String(template)
    .replaceAll('{user}', `<@${user.id}>`)
    .replaceAll('{username}', user.username)
    .replaceAll('{level}', String(level))
    .replaceAll('{server}', guild?.name ?? '');
}

const XP_COOLDOWN_MS = 5000;
const lastGain = new Map();

export function xpForMessage(len) {
  if (len >= 120) return 60;
  if (len >= 60) return 30;
  if (len >= 30) return 20;
  if (len >= 6) return 10;
  return 0;
}

export function xpForLevel(n) {
  const lvl = Math.max(0, Math.floor(n));
  return 20 * lvl * lvl + 80 * lvl;
}

export function levelFromXp(xp) {
  if (xp < 100) return 0;
  return Math.floor((-80 + Math.sqrt(6400 + 80 * xp)) / 40);
}

export function levelInfo(xp) {
  const level = levelFromXp(xp);
  const floor = xpForLevel(level);
  const ceil = xpForLevel(level + 1);
  return { level, xp, into: xp - floor, span: ceil - floor, toNext: ceil - xp };
}

export function xpDeltaForLevels(currentXp, deltaLevels) {
  const lvl = levelFromXp(currentXp);
  const target = Math.max(0, lvl + deltaLevels);
  return xpForLevel(target) - xpForLevel(lvl);
}

// --- Carte de passage de niveau (style Draftbot) ---
export async function renderLevelUpCard(user, member, level) {
  const W = 620;
  const H = 180;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Fond arrondi sombre.
  ctx.fillStyle = '#1e1f22';
  ctx.beginPath();
  ctx.roundRect(0, 0, W, H, 18);
  ctx.fill();

  // Avatar rond à gauche.
  const img = await fetchImage((member ?? user).displayAvatarURL({ extension: 'png', size: 128 }));
  const size = 112;
  const cx = 96;
  const cy = H / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.clip();
  if (img) ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
  else {
    ctx.fillStyle = '#4e5058';
    ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
  }
  ctx.restore();

  // Textes.
  const x = 176;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  ctx.font = font(46, { bold: true });
  ctx.fillText('Félicitations !', x, 78);
  ctx.fillStyle = '#b5bac1';
  ctx.font = font(26);
  ctx.fillText('vous avez atteint', x, 112);
  ctx.fillStyle = '#ffffff';
  ctx.font = font(30, { bold: true });
  ctx.fillText(`le niveau ${level}`, x, 146);

  return new AttachmentBuilder(await canvas.encode('png'), { name: 'levelup.png' });
}

// À chaque message : crédite l'XP et annonce un éventuel passage de niveau.
export async function grantMessageXp(message) {
  if (!message.guild || message.author?.bot) return;
  const gain = xpForMessage((message.content ?? '').trim().length);
  if (!gain) return;

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
  if (newLevel > oldLevel) await announceLevelUp(message, newLevel).catch((err) => console.error('[levels]', err));
}

// Rôles-récompenses cumulatifs selon le niveau atteint.
export async function syncLevelRoles(member, level = 0) {
  const rewards = getLevelRewards(member.guild.id);
  for (const [lvlStr, roleId] of Object.entries(rewards)) {
    const lvl = Number(lvlStr);
    const has = member.roles.cache.has(roleId);
    if (level >= lvl && !has) await member.roles.add(roleId, `Récompense de niveau ${lvl}`).catch(() => {});
    else if (level < lvl && has) await member.roles.remove(roleId, `Niveau ${lvl} non atteint`).catch(() => {});
  }
}

// Annonce : message texte + carte image, dans le salon dédié ou celui du message.
async function announceLevelUp(message, level) {
  const dedicatedId = levelUpChannelId(message.guild.id);
  let channel = message.channel;
  if (dedicatedId) {
    channel = message.guild.channels.cache.get(dedicatedId) ?? (await message.guild.channels.fetch(dedicatedId).catch(() => null));
    if (!channel?.isTextBased()) return;
  }
  const template = getLevelUpMessage(message.guild.id) ?? DEFAULT_LEVELUP;
  const content = formatLevelUp(template, { user: message.author, level, guild: message.guild });
  const card = await renderLevelUpCard(message.author, message.member, level).catch(() => null);
  await channel.send({ content, files: card ? [card] : [], allowedMentions: { users: [message.author.id] } });
}
