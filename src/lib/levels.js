// Système de niveaux (XP).
// - Gain automatique à chaque message, selon la longueur du message.
// - Courbe : XP cumulée pour ATTEINDRE le niveau n = 20n² + 80n.
import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { font, fetchImage } from './fonts.js';
import { addXp, getXp, levelUpChannelId, getLevelRewards, getLevelRewardModes, getLevelUpMessage, getLevelsEnabled, addMoney } from './store.js';

// Image de fond de la carte de niveau (embarquée dans le projet : un lien Discord expire).
const BG_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'levelup-bg.jpg');
let bgImage;
let bgLoaded = false;
async function levelBackground() {
  if (bgLoaded) return bgImage;
  bgLoaded = true;
  try {
    bgImage = await loadImage(readFileSync(BG_PATH));
  } catch {
    bgImage = null;
  }
  return bgImage;
}

// Argent gagné pour chaque niveau franchi (dépensable dans /shop).
export const MONEY_PER_LEVEL = 200;

// Couleur des embeds du système de niveaux (annonce, /niveau, /niveaux, récompenses).
export const LEVEL_COLOR = 0xffffff;

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

// --- Argent gagné par message ---
// 5$ par message, 25$ si le message fait plus de 125 caractères.
const MONEY_PER_MESSAGE = 5;
const MONEY_LONG_MESSAGE = 25;
const LONG_MESSAGE_LEN = 125;
const MONEY_COOLDOWN_MS = 5000;
const lastMoneyGain = new Map();

export function moneyForMessage(len) {
  if (len > LONG_MESSAGE_LEN) return MONEY_LONG_MESSAGE;
  if (len >= 1) return MONEY_PER_MESSAGE;
  return 0;
}

// À chaque message : crédite l'argent (indépendant du système d'XP).
export function grantMessageMoney(message) {
  if (!message.guild || message.author?.bot) return;
  const gain = moneyForMessage((message.content ?? '').trim().length);
  if (!gain) return;

  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  if (now - (lastMoneyGain.get(key) ?? 0) < MONEY_COOLDOWN_MS) return;
  lastMoneyGain.set(key, now);

  addMoney(message.guild.id, message.author.id, gain);
}

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

  // Fond arrondi : image de fond (recadrée pour couvrir), sinon couleur sombre.
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0, 0, W, H, 18);
  ctx.clip();
  const bg = await levelBackground();
  if (bg) {
    const scale = Math.max(W / bg.width, H / bg.height);
    const dw = bg.width * scale;
    const dh = bg.height * scale;
    ctx.drawImage(bg, (W - dw) / 2, (H - dh) / 2, dw, dh);
    // Voile sombre dégradé (gauche → droite) pour garder le texte lisible.
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0.75)');
    grad.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = '#1e1f22';
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();

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

  // Textes (légère ombre pour rester lisibles par-dessus l'image).
  const x = 176;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = '#ffffff';
  ctx.font = font(46, { bold: true });
  ctx.fillText('Félicitations !', x, 78);
  ctx.fillStyle = '#e3e5e8';
  ctx.font = font(26);
  ctx.fillText('vous avez atteint', x, 112);
  ctx.fillStyle = '#ffffff';
  ctx.font = font(30, { bold: true });
  ctx.fillText(`le niveau ${level}`, x, 146);
  ctx.shadowBlur = 0;

  return new AttachmentBuilder(await canvas.encode('png'), { name: 'levelup.png' });
}

// À chaque message : crédite l'XP et annonce un éventuel passage de niveau.
export async function grantMessageXp(message) {
  if (!message.guild || message.author?.bot) return;
  if (!getLevelsEnabled(message.guild.id)) return; // système désactivé via /configniveau
  const gain = xpForMessage((message.content ?? '').trim().length);
  if (!gain) return;

  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  if (now - (lastGain.get(key) ?? 0) < XP_COOLDOWN_MS) return;
  lastGain.set(key, now);

  const { before, after } = addXp(message.guild.id, message.author.id, gain);
  const oldLevel = levelFromXp(before);
  const newLevel = levelFromXp(after);
  // Rôles-récompenses remis à jour à chaque gain (pas seulement au changement de niveau) :
  // un palier ajouté après coup ou celui du niveau 0 est donné dès le message suivant.
  const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (member) await syncLevelRoles(member, newLevel).catch(() => {});
  if (newLevel > oldLevel) {
    // Récompense en argent pour chaque niveau gagné.
    addMoney(message.guild.id, message.author.id, MONEY_PER_LEVEL * (newLevel - oldLevel));
    await announceLevelUp(message, newLevel).catch((err) => console.error('[levels]', err));
  }
}

// À l'arrivée d'un membre : rôles-récompenses de son niveau (palier 0 pour un nouveau,
// son ancien niveau s'il revient), si le système de niveaux est activé.
export async function syncMemberLevelRoles(member) {
  if (!getLevelsEnabled(member.guild.id)) return;
  await syncLevelRoles(member, levelFromXp(getXp(member.guild.id, member.id)));
}

// Rôles-récompenses selon le niveau atteint. « addition » : gardé dès le palier atteint ;
// « évolutif » : seul le rôle du plus haut palier évolutif atteint est gardé (il remplace les précédents).
export async function syncLevelRoles(member, level = 0) {
  const rewards = Object.entries(getLevelRewards(member.guild.id)).map(([lvl, roleId]) => [Number(lvl), roleId]);
  const modes = getLevelRewardModes(member.guild.id);
  const topEvolving = Math.max(-1, ...rewards.filter(([lvl]) => modes[lvl] === 'evolutif' && level >= lvl).map(([lvl]) => lvl));
  // Un même rôle peut servir à plusieurs paliers : il est gardé si l'un d'eux le donne.
  const wanted = new Map();
  for (const [lvl, roleId] of rewards) {
    const keep = modes[lvl] === 'evolutif' ? lvl === topEvolving : level >= lvl;
    if (keep) wanted.set(roleId, lvl);
    else if (!wanted.has(roleId)) wanted.set(roleId, null);
  }
  for (const [roleId, lvl] of wanted) {
    const has = member.roles.cache.has(roleId);
    if (lvl !== null && !has) await member.roles.add(roleId, `Récompense de niveau ${lvl}`).catch(() => {});
    else if (lvl === null && has) await member.roles.remove(roleId, 'Palier de niveau non atteint ou remplacé').catch(() => {});
  }
}

// Annonce : embed (message + carte image en fond), dans le salon dédié ou celui du message.
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

  const embed = new EmbedBuilder().setColor(LEVEL_COLOR).setDescription(content);
  if (card) embed.setImage('attachment://levelup.png');

  // La mention reste dans le contenu pour notifier le membre (un embed ne ping pas).
  await channel.send({
    content: `<@${message.author.id}>`,
    embeds: [embed],
    files: card ? [card] : [],
    allowedMentions: { users: [message.author.id] },
  });
}
