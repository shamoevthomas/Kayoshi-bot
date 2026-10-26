// Système de niveaux (XP).
// - Gain automatique à chaque message, selon la longueur du message.
// - Courbe : XP cumulée pour ATTEINDRE le niveau n = 20n² + 80n.
import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { font, fetchImage } from './fonts.js';
import {
  addXp,
  getXp,
  levelUpChannelId,
  getLevelRewards,
  getLevelRewardModes,
  getLevelMoneyRewards,
  getLevelUpMessage,
  getLevelsEnabled,
  addMoney,
} from './store.js';
import { formatMoney } from './shop.js';

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

const XP_COOLDOWN_MS = 3000;
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

// XP selon la longueur du message (sans texte, ex. une image seule : rien).
export function xpForMessage(len) {
  if (len >= 120) return 75;
  if (len >= 60) return 40;
  if (len >= 30) return 30;
  if (len >= 6) return 20;
  if (len >= 1) return 3;
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

// --- Cartes en image (style Draftbot) : fond, avatar rond à gauche, trois lignes de texte ---
// lines = [{ text, size, bold, color, y }] ; le texte trop long est resserré pour tenir dans la carte.
async function renderCard(user, member, lines, name) {
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
  for (const line of lines) {
    ctx.fillStyle = line.color;
    ctx.font = font(line.size, { bold: line.bold });
    ctx.fillText(line.text, x, line.y, W - x - 24);
  }
  ctx.shadowBlur = 0;

  return new AttachmentBuilder(await canvas.encode('png'), { name });
}

// Passage de niveau.
export function renderLevelUpCard(user, member, level) {
  return renderCard(
    user,
    member,
    [
      { text: 'Félicitations !', size: 46, bold: true, color: '#ffffff', y: 78 },
      { text: 'vous avez atteint', size: 26, color: '#e3e5e8', y: 112 },
      { text: `le niveau ${level}`, size: 30, bold: true, color: '#ffffff', y: 146 },
    ],
    'levelup.png',
  );
}

// Rôle(s)-récompense obtenu(s) en passant un palier : nom du rôle dans sa couleur.
function renderRoleRewardCard(user, member, roles) {
  const colored = roles.find((r) => r.color);
  return renderCard(
    user,
    member,
    [
      { text: 'Félicitations !', size: 46, bold: true, color: '#ffffff', y: 78 },
      { text: roles.length > 1 ? 'nouveaux rôles débloqués' : 'nouveau rôle débloqué', size: 26, color: '#e3e5e8', y: 112 },
      { text: roles.map((r) => `@${r.name}`).join(', '), size: 30, bold: true, color: colored ? colored.hexColor : '#ffffff', y: 146 },
    ],
    'role.png',
  );
}

// Argent gagné en passant un palier (« salaire »).
function renderSalaryCard(user, member, amount) {
  return renderCard(
    user,
    member,
    [
      { text: 'Salaire', size: 30, bold: true, color: '#e3e5e8', y: 66 },
      { text: `+${formatMoney(amount)} 💰`, size: 50, bold: true, color: '#f5c542', y: 122 },
      { text: 'ajouté à ton solde', size: 24, color: '#e3e5e8', y: 156 },
    ],
    'salaire.png',
  );
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
  await afterXpChange(message, levelFromXp(before), levelFromXp(after));
}

// Niveaux gagnés d'un coup (quêtes) : convertis en XP, puis traités comme un vrai passage de niveau.
// Renvoie le nouveau niveau.
export async function grantLevels(ctx, levels) {
  const current = getXp(ctx.guild.id, ctx.author.id);
  const { before, after } = addXp(ctx.guild.id, ctx.author.id, xpDeltaForLevels(current, levels));
  await afterXpChange(ctx, levelFromXp(before), levelFromXp(after));
  return levelFromXp(after);
}

// Après un gain d'XP. ctx = { guild, author, member, channel } (un message convient ; channel peut
// être null). Rôles-récompenses remis à jour à chaque gain (pas seulement au changement de niveau) :
// un palier ajouté après coup ou celui du niveau 0 est donné dès le message suivant.
// En cas de passage de niveau : argent, annonce, rôles et salaire des paliers franchis.
async function afterXpChange(ctx, oldLevel, newLevel) {
  const member = ctx.member ?? (await ctx.guild.members.fetch(ctx.author.id).catch(() => null));
  const added = member ? await syncLevelRoles(member, newLevel).catch(() => []) : [];
  if (newLevel <= oldLevel) return;

  // Récompense en argent pour chaque niveau gagné, plus celle des paliers franchis (/xp recompense).
  const moneyRewards = getLevelMoneyRewards(ctx.guild.id);
  let bonus = 0;
  for (let lvl = oldLevel + 1; lvl <= newLevel; lvl++) bonus += moneyRewards[lvl] ?? 0;
  addMoney(ctx.guild.id, ctx.author.id, MONEY_PER_LEVEL * (newLevel - oldLevel) + bonus);

  const channel = await levelChannel(ctx);
  if (channel) await announceLevelUp(channel, ctx, newLevel).catch((err) => console.error('[levels]', err));
  // Récompenses : dans le salon où le membre vient d'agir. Rôles des paliers franchis
  // par ce gain seulement (pas ceux remis après un retrait à la main).
  if (!ctx.channel) return;
  const roles = added
    .filter((r) => r.lvl > oldLevel && r.lvl <= newLevel)
    .map((r) => ctx.guild.roles.cache.get(r.roleId))
    .filter(Boolean);
  if (roles.length) await announceRoleRewards(ctx.channel, ctx, roles).catch((err) => console.error('[levels]', err));
  if (bonus) await announceSalary(ctx.channel, ctx, bonus).catch((err) => console.error('[levels]', err));
}

// À l'arrivée d'un membre : rôles-récompenses de son niveau (palier 0 pour un nouveau,
// son ancien niveau s'il revient), si le système de niveaux est activé.
export async function syncMemberLevelRoles(member) {
  if (!getLevelsEnabled(member.guild.id)) return;
  await syncLevelRoles(member, levelFromXp(getXp(member.guild.id, member.id)));
}

// Rôles-récompenses selon le niveau atteint. « addition » : gardé dès le palier atteint ;
// « évolutif » : seul le rôle du plus haut palier évolutif atteint est gardé (il remplace les précédents).
// Renvoie les rôles ajoutés : [{ roleId, lvl }].
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
  const added = [];
  for (const [roleId, lvl] of wanted) {
    const has = member.roles.cache.has(roleId);
    if (lvl !== null && !has) {
      const ok = await member.roles
        .add(roleId, `Récompense de niveau ${lvl}`)
        .then(() => true)
        .catch(() => false);
      if (ok) added.push({ roleId, lvl });
    } else if (lvl === null && has) await member.roles.remove(roleId, 'Palier de niveau non atteint ou remplacé').catch(() => {});
  }
  return added;
}

// Salon des annonces de niveau : celui de /configniveau, sinon celui du message.
async function levelChannel(message) {
  const dedicatedId = levelUpChannelId(message.guild.id);
  if (!dedicatedId) return message.channel;
  const channel = message.guild.channels.cache.get(dedicatedId) ?? (await message.guild.channels.fetch(dedicatedId).catch(() => null));
  return channel?.isTextBased() ? channel : null;
}

// Embed (texte + carte en image) envoyé dans le salon des annonces de niveau.
async function sendCard(channel, text, card, ping = null) {
  const embed = new EmbedBuilder().setColor(LEVEL_COLOR).setDescription(text);
  if (card) embed.setImage(`attachment://${card.name}`);
  await channel.send({
    content: ping ? `<@${ping}>` : undefined,
    embeds: [embed],
    files: card ? [card] : [],
    allowedMentions: { users: ping ? [ping] : [] },
  });
}

// Passage de niveau. La mention reste dans le contenu pour notifier le membre (un embed ne ping pas).
async function announceLevelUp(channel, message, level) {
  const template = getLevelUpMessage(message.guild.id) ?? DEFAULT_LEVELUP;
  const content = formatLevelUp(template, { user: message.author, level, guild: message.guild });
  const card = await renderLevelUpCard(message.author, message.member, level).catch(() => null);
  await sendCard(channel, content, card, message.author.id);
}

// Rôle(s) gagné(s) en passant un palier (déjà notifié par l'annonce du niveau : pas de nouveau ping).
async function announceRoleRewards(channel, message, roles) {
  const list = roles.map((r) => `${r}`).join(', ');
  const text = roles.length > 1 ? `🎉 Félicitations ${message.author}, tu as gagné les rôles ${list} !` : `🎉 Félicitations ${message.author}, tu as gagné le rôle ${list} !`;
  const card = await renderRoleRewardCard(message.author, message.member, roles).catch(() => null);
  await sendCard(channel, text, card);
}

// Argent d'un palier (/xp recompense … argent).
async function announceSalary(channel, message, amount) {
  const card = await renderSalaryCard(message.author, message.member, amount).catch(() => null);
  await sendCard(channel, `💸 Voici ton salaire ${message.author} : 💰 **+${formatMoney(amount)}**`, card);
}
