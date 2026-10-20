import { createCanvas } from '@napi-rs/canvas';
import { PERIOD_DAYS, TIME_ZONE } from './stats.js';
import { font, iconFont, fetchImage } from './fonts.js';

// Cartes d'images des stats (s?u, s?t, s?m, s?v), dans le style de Statbot.

const C = {
  bg: '#313338',
  panel: '#232428',
  row: '#2b2d31',
  tag: '#1e1f22',
  pill: '#4e5058',
  text: '#f2f3f5',
  muted: '#b5bac1',
  dim: '#80848e',
  green: '#3ba55c',
  pink: '#eb459e',
};
const W = 1100;
const M = 24; // marge
const G = 16; // espace entre panneaux

// --- Formats (français) ---
const fr = (n, digits) => n.toLocaleString('fr-FR', { maximumFractionDigits: digits }).replace(/[  ]/g, ' ');
export function compact(n) {
  if (n < 1000) return String(n);
  if (n < 1e6) return `${fr(Number((n / 1000).toPrecision(3)), 2)}k`;
  return `${fr(Number((n / 1e6).toPrecision(3)), 2)}M`;
}
export const toHours = (seconds) => fr(Math.round((seconds / 3600) * 100) / 100, 2);
const plural = (n, word) => (n > 1 ? `${word}s` : word);
const dateFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TIME_ZONE });

// --- Dessin ---
function box(ctx, x, y, w, h, r, color) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = color;
  ctx.fill();
}

// Coupe le texte avec « … » pour qu'il tienne dans maxWidth (police déjà réglée).
function fit(ctx, str, maxWidth) {
  if (ctx.measureText(str).width <= maxWidth) return str;
  const chars = [...str];
  while (chars.length && ctx.measureText(`${chars.join('')}…`).width > maxWidth) chars.pop();
  return `${chars.join('')}…`;
}

function text(ctx, str, x, y, { size = 26, bold = false, italic = false, color = C.text, align = 'left', max = Infinity } = {}) {
  ctx.font = font(size, { bold, italic });
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  const shown = fit(ctx, String(str), max);
  ctx.fillText(shown, x, y);
  return ctx.measureText(shown).width;
}

// Suite de morceaux de texte de styles différents, à la suite. Renvoie la largeur totale.
function runs(ctx, parts, x, y, { align = 'left' } = {}) {
  const widths = parts.map((p) => {
    ctx.font = font(p.size ?? 22, p);
    return ctx.measureText(p.t).width;
  });
  const total = widths.reduce((a, b) => a + b, 0);
  let cx = align === 'right' ? x - total : x;
  parts.forEach((p, i) => {
    text(ctx, p.t, cx, y, { size: p.size ?? 22, bold: p.bold, italic: p.italic, color: p.color ?? C.text });
    cx += widths[i];
  });
  return total;
}

function icon(ctx, glyph, x, y, size = 28, color = C.muted, align = 'right') {
  ctx.font = glyph === '#' ? font(size + 4, { bold: true }) : iconFont(size);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(glyph, x, y);
}

// Image ronde (avatar, icône du serveur), ou initiale sur fond gris si indisponible.
function roundImage(ctx, img, x, y, size, fallback = '?') {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (img) ctx.drawImage(img, x, y, size, size);
  else {
    ctx.fillStyle = C.pill;
    ctx.fillRect(x, y, size, size);
    text(ctx, [...fallback][0]?.toUpperCase() ?? '?', x + size / 2, y + size / 2, { size: size * 0.45, bold: true, align: 'center' });
  }
  ctx.restore();
}

function panel(ctx, x, y, w, h, title, glyph) {
  box(ctx, x, y, w, h, 18, C.panel);
  text(ctx, title, x + 20, y + 32, { size: 26, bold: true, max: w - (glyph ? 64 : 40) });
  if (glyph) icon(ctx, glyph, x + w - 20, y + 32, 28);
}

// Ligne « 1j | 142 messages ».
function periodRow(ctx, x, y, w, h, tag, value, unit) {
  box(ctx, x, y, w, h, 10, C.row);
  box(ctx, x, y, 62, h, 10, C.tag);
  text(ctx, tag, x + 31, y + h / 2, { size: 25, bold: true, align: 'center' });
  runs(ctx, [{ t: `${value} `, size: 27, bold: true }, { t: unit, size: 24, italic: true, color: C.muted }], x + 78, y + h / 2);
}

function footer(ctx, H, botImg, botName) {
  const y = H - 26;
  runs(
    ctx,
    [
      { t: 'Période d’analyse : ', bold: true, size: 21 },
      { t: `${PERIOD_DAYS} derniers jours`, size: 21, color: C.muted },
      { t: ' — ', size: 21, color: C.dim },
      { t: 'Fuseau horaire : ', bold: true, size: 21 },
      { t: TIME_ZONE, size: 21, color: C.muted },
    ],
    M,
    y,
  );
  const width = runs(ctx, [{ t: 'Propulsé par ', size: 21, color: C.muted }, { t: botName, size: 21, bold: true }], W - M, y, { align: 'right' });
  roundImage(ctx, botImg, W - M - width - 36, y - 14, 28, botName);
}

function frame(H) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  box(ctx, 0, 0, W, H, 28, C.bg);
  return { canvas, ctx };
}

// En-tête des cartes du serveur : grande image ou pictogramme, titre, sous-titre.
function serverHeader(ctx, { title, subtitle, guildName, guildImg, bigImg, bigGlyph }) {
  if (bigGlyph) icon(ctx, bigGlyph, M + 48, 66, 84, C.text, 'center');
  else roundImage(ctx, bigImg, M, 18, 100, guildName);
  text(ctx, title, M + 124, 54, { size: 46, bold: true, max: W - 2 * M - 124 });
  if (subtitle) {
    roundImage(ctx, guildImg, M + 124, 88, 30, guildName);
    text(ctx, subtitle, M + 164, 104, { size: 25, color: C.muted, max: W - 2 * M - 164 });
  }
}

// Ligne d'un classement : rang, nom, valeur.
function rankRow(ctx, x, y, w, h, rank, name, value) {
  box(ctx, x, y, 56, h, 10, C.panel);
  text(ctx, rank, x + 28, y + h / 2, { size: 27, bold: true, align: 'center' });
  box(ctx, x + 66, y, w - 66, h, 10, C.panel);
  ctx.font = font(25, { bold: true });
  const valueWidth = ctx.measureText(value).width + 32;
  box(ctx, x + w - valueWidth - 10, y + 8, valueWidth, h - 16, 8, C.tag);
  text(ctx, value, x + w - 10 - valueWidth / 2, y + h / 2, { size: 25, bold: true, align: 'center' });
  text(ctx, name, x + 86, y + h / 2, { size: 26, max: w - 66 - valueWidth - 50 });
}

// Ligne d'un top : nom dans une étiquette, puis valeur et unité.
function topRow(ctx, x, y, w, h, label, value, unit, tagWidth) {
  box(ctx, x, y, w, h, 10, C.row);
  box(ctx, x, y, tagWidth, h, 10, C.tag);
  text(ctx, label, x + 16, y + h / 2, { size: 24, bold: true, max: tagWidth - 26 });
  runs(ctx, [{ t: `${value} `, size: 25 }, { t: unit, size: 22, italic: true, color: C.muted }], x + tagWidth + 16, y + h / 2);
}

function emptyNote(ctx, x, y, w) {
  text(ctx, 'Pas encore de données', x + w / 2, y, { size: 22, italic: true, color: C.dim, align: 'center' });
}

// Graphique : une courbe lissée par série, chacune à sa propre échelle.
function chart(ctx, x, y, w, h, series) {
  ctx.strokeStyle = '#3f4147';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 3; i++) {
    const gy = y + (h * i) / 3;
    ctx.beginPath();
    ctx.moveTo(x, gy);
    ctx.lineTo(x + w, gy);
    ctx.stroke();
  }
  for (const { values, color } of series) {
    const max = Math.max(...values, 0);
    const pts = values.map((v, i) => [x + (w * i) / Math.max(values.length - 1, 1), y + h - (max ? (v / max) * (h - 6) : 0) - 3]);
    ctx.beginPath();
    ctx.moveTo(...pts[0]);
    for (let i = 1; i < pts.length; i++) {
      const [px, py] = pts[i - 1];
      const [cx, cy] = pts[i];
      const mx = (px + cx) / 2;
      ctx.bezierCurveTo(mx, py, mx, cy, cx, cy);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}

function dateBox(ctx, x, label, date) {
  ctx.font = font(21, { bold: true });
  const pillW = ctx.measureText(label).width + 28;
  box(ctx, x + (220 - pillW) / 2, 18, pillW, 34, 8, C.pill);
  text(ctx, label, x + 110, 35, { size: 21, bold: true, align: 'center' });
  box(ctx, x, 60, 220, 52, 10, C.panel);
  text(ctx, date, x + 110, 86, { size: 25, align: 'center', max: 204 });
}

// --- s?u : stats d'un membre ---
export async function renderUserCard({ user, member, guild, stats, channelName, botUser }) {
  const H = 640;
  const { canvas, ctx } = frame(H);
  const [avatar, guildImg, botImg] = await Promise.all([
    fetchImage(member?.displayAvatarURL({ extension: 'png', size: 128 }) ?? user.displayAvatarURL({ extension: 'png', size: 128 })),
    fetchImage(guild.iconURL({ extension: 'png', size: 64 })),
    fetchImage(botUser.displayAvatarURL({ extension: 'png', size: 64 })),
  ]);

  // En-tête : avatar, nom, serveur, dates.
  roundImage(ctx, avatar, M, 16, 104, user.username);
  const displayName = member?.displayName ?? user.globalName ?? user.username;
  const nameWidth = text(ctx, displayName, M + 124, 54, { size: 44, bold: true, max: 420 });
  if (displayName !== user.username) text(ctx, user.username, M + 136 + nameWidth, 58, { size: 28, color: C.muted, max: 440 - nameWidth });
  roundImage(ctx, guildImg, M + 124, 88, 30, guild.name);
  text(ctx, guild.name, M + 164, 104, { size: 25, color: C.muted, max: 380 });
  dateBox(ctx, W - M - 220 * 2 - 16, 'Créé le', dateFormat.format(user.createdAt));
  dateBox(ctx, W - M - 220, 'Rejoint le', member?.joinedAt ? dateFormat.format(member.joinedAt) : '—');

  // Ligne 1 : classement, messages, vocal.
  const y0 = 140;
  const h0 = 236;
  const pw = (W - 2 * M - 2 * G) / 3;
  const xs = [M, M + pw + G, M + 2 * (pw + G)];
  panel(ctx, xs[0], y0, pw, h0, 'Classement serveur', '🏆');
  for (const [i, [label, rank]] of [
    ['Message', stats.rank.messages],
    ['Vocale', stats.rank.voice],
  ].entries()) {
    const ry = y0 + 66 + i * 82;
    box(ctx, xs[0] + 18, ry, pw - 36, 70, 10, C.row);
    box(ctx, xs[0] + 18, ry, 150, 70, 10, C.tag);
    text(ctx, label, xs[0] + 18 + 75, ry + 35, { size: 26, bold: true, align: 'center' });
    text(ctx, rank ? `#${rank}` : '—', xs[0] + 18 + 150 + (pw - 36 - 150) / 2, ry + 35, { size: 30, bold: true, align: 'center' });
  }
  const periods = [
    ['1j', 'd1'],
    ['7j', 'd7'],
    [`${PERIOD_DAYS}j`, 'd14'],
  ];
  panel(ctx, xs[1], y0, pw, h0, 'Messages', '#');
  panel(ctx, xs[2], y0, pw, h0, 'Activité vocale', '🔊');
  periods.forEach(([tag, k], i) => {
    const ry = y0 + 66 + i * 56;
    periodRow(ctx, xs[1] + 18, ry, pw - 36, 46, tag, compact(stats.messages[k]), plural(stats.messages[k], 'message'));
    periodRow(ctx, xs[2] + 18, ry, pw - 36, 46, tag, toHours(stats.voice[k]), 'heures');
  });

  // Ligne 2 : salons préférés, graphique.
  const y1 = y0 + h0 + G;
  const h1 = 196;
  const hw = (W - 2 * M - G) / 2;
  panel(ctx, M, y1, hw, h1, 'Top des salons', '📈');
  const favorites = [
    ['#', stats.topMessageChannel, (v) => [compact(v), plural(v, 'message')]],
    ['🔊', stats.topVoiceChannel, (v) => [toHours(v), 'heures']],
  ];
  favorites.forEach(([glyph, top, format], i) => {
    const ry = y1 + 66 + i * 60;
    icon(ctx, glyph, M + 34, ry + 24, 24, C.muted, 'center');
    if (!top) {
      box(ctx, M + 60, ry, hw - 80, 48, 10, C.row);
      text(ctx, 'Aucun', M + 76, ry + 24, { size: 23, italic: true, color: C.dim });
      return;
    }
    const [value, unit] = format(top.value);
    topRow(ctx, M + 60, ry, hw - 80, 48, channelName(top.id), value, unit, 250);
  });
  const cx = M + hw + G;
  panel(ctx, cx, y1, hw, h1, 'Graphiques');
  runs(
    ctx,
    [
      { t: '● ', size: 22, color: C.green },
      { t: 'Message   ', size: 22, bold: true },
      { t: '● ', size: 22, color: C.pink },
      { t: 'Vocale', size: 22, bold: true },
    ],
    cx + hw - 20,
    y1 + 32,
    { align: 'right' },
  );
  chart(ctx, cx + 20, y1 + 64, hw - 40, h1 - 82, [
    { values: stats.graph.map((d) => d.messages), color: C.green },
    { values: stats.graph.map((d) => d.voice), color: C.pink },
  ]);

  footer(ctx, H, botImg, botUser.username);
  return canvas.encode('png');
}

// --- s?t : top du serveur ---
export async function renderTopCard({ guild, stats, memberName, channelName, botUser }) {
  const H = 770;
  const { canvas, ctx } = frame(H);
  const [guildImg, botImg] = await Promise.all([
    fetchImage(guild.iconURL({ extension: 'png', size: 128 })),
    fetchImage(botUser.displayAvatarURL({ extension: 'png', size: 64 })),
  ]);
  roundImage(ctx, guildImg, M, 18, 100, guild.name);
  text(ctx, guild.name, M + 124, 54, { size: 46, bold: true, max: W - 2 * M - 124 });
  icon(ctx, '🏆', M + 124, 104, 26, C.muted, 'left');
  text(ctx, 'Top statistiques', M + 160, 104, { size: 26, color: C.muted });

  const cw = (W - 2 * M - G) / 2;
  const sections = [
    ['#', 'Messages', 160, stats.topMessageMembers, stats.topMessageChannels, (v) => fr(v, 0)],
    ['🔊', 'Activité vocale', 452, stats.topVoiceMembers, stats.topVoiceChannels, (v) => `${toHours(v)} h`],
  ];
  for (const [glyph, title, sy, members, channels, format] of sections) {
    icon(ctx, glyph, M + 16, sy, 30, C.text, 'center');
    text(ctx, title, M + 44, sy, { size: 32, bold: true });
    for (const [col, list, nameOf] of [
      [0, members, memberName],
      [1, channels, (id) => channelName(id)],
    ]) {
      const x = M + col * (cw + G);
      if (!list.length) emptyNote(ctx, x, sy + 120, cw);
      list.forEach((entry, i) => {
        rankRow(ctx, x, sy + 34 + i * 70, cw, 58, String(i + 1), nameOf(entry.id), format(entry.value));
      });
    }
  }

  footer(ctx, H, botImg, botUser.username);
  return canvas.encode('png');
}

// --- s?m et s?v : messages ou vocal du serveur ---
export async function renderActivityCard({ kind, guild, stats, memberName, channelName, botUser }) {
  const H = 650;
  const { canvas, ctx } = frame(H);
  const [guildImg, botImg] = await Promise.all([
    fetchImage(guild.iconURL({ extension: 'png', size: 64 })),
    fetchImage(botUser.displayAvatarURL({ extension: 'png', size: 64 })),
  ]);
  const isVoice = kind === 'voice';
  serverHeader(ctx, {
    title: isVoice ? 'Activité vocale' : 'Messages',
    subtitle: guild.name,
    guildName: guild.name,
    guildImg,
    bigGlyph: isVoice ? '🔊' : '#',
  });

  // Ligne 1 : total de la période, messages et vocal sur 1, 7 et 30 jours.
  const y0 = 140;
  const h0 = 236;
  const pw = (W - 2 * M - 2 * G) / 3;
  const xs = [M, M + pw + G, M + 2 * (pw + G)];
  panel(ctx, xs[0], y0, pw, h0, 'Période d’analyse', '🗘');
  const total = isVoice ? stats.voice.d14 : stats.messages.d14;
  text(ctx, isVoice ? toHours(total) : compact(total), xs[0] + pw / 2, y0 + 128, { size: 76, bold: true, align: 'center', max: pw - 40 });
  text(ctx, isVoice ? 'heures' : plural(total, 'message'), xs[0] + pw / 2, y0 + 190, { size: 40, italic: true, color: C.muted, align: 'center' });
  panel(ctx, xs[1], y0, pw, h0, 'Messages', '#');
  panel(ctx, xs[2], y0, pw, h0, 'Activité vocale', '🔊');
  [
    ['1j', 'd1'],
    ['7j', 'd7'],
    ['30j', 'd30'],
  ].forEach(([tag, k], i) => {
    const ry = y0 + 66 + i * 56;
    periodRow(ctx, xs[1] + 18, ry, pw - 36, 46, tag, compact(stats.messages[k]), plural(stats.messages[k], 'message'));
    periodRow(ctx, xs[2] + 18, ry, pw - 36, 46, tag, toHours(stats.voice[k]), 'heures');
  });

  // Ligne 2 : top des membres et des salons.
  const y1 = y0 + h0 + G;
  const h1 = 204;
  const hw = (W - 2 * M - G) / 2;
  const members = isVoice ? stats.topVoiceMembers : stats.topMessageMembers;
  const channels = isVoice ? stats.topVoiceChannels : stats.topMessageChannels;
  const format = isVoice ? (v) => [toHours(v), 'heures'] : (v) => [compact(v), plural(v, 'message')];
  for (const [col, title, list, label, glyph] of [
    [0, isVoice ? 'Top des membres en vocal' : 'Top des membres par message', members, memberName, isVoice ? '🔊' : '#'],
    [1, isVoice ? 'Top des salons vocaux' : 'Top des salons de messages', channels, (id) => channelName(id), isVoice ? '🔊' : '#'],
  ]) {
    const x = M + col * (hw + G);
    panel(ctx, x, y1, hw, h1, title, glyph);
    if (!list.length) emptyNote(ctx, x, y1 + 120, hw);
    list.forEach((entry, i) => {
      const [value, unit] = format(entry.value);
      topRow(ctx, x + 18, y1 + 62 + i * 46, hw - 36, 38, label(entry.id), value, unit, 250);
    });
  }

  footer(ctx, H, botImg, botUser.username);
  return canvas.encode('png');
}
