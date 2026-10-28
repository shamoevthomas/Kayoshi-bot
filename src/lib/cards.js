import { AttachmentBuilder } from 'discord.js';
import { createCanvas } from '@napi-rs/canvas';
import { font } from './fonts.js';

// Jeu de 52 cartes (blackjack et poker du casino) et rendu de la table en image.
// Figures à la française : V (valet), D (dame), R (roi). Les couleurs sont dessinées (pas de police).
export const SUITS = ['♠', '♥', '♦', '♣'];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R'];
const RED = new Set(['♥', '♦']);

export function newDeck() {
  const deck = SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export const cardText = (c) => `${c.rank}${c.suit}`;

// --- Dessin ---
const CARD_W = 104;
const CARD_H = 146;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// Couleur centrée en (x, y), de taille s.
function drawSuit(ctx, suit, x, y, s) {
  ctx.beginPath();
  if (suit === '♦') {
    ctx.moveTo(x, y - 0.5 * s);
    ctx.quadraticCurveTo(x + 0.18 * s, y - 0.18 * s, x + 0.4 * s, y);
    ctx.quadraticCurveTo(x + 0.18 * s, y + 0.18 * s, x, y + 0.5 * s);
    ctx.quadraticCurveTo(x - 0.18 * s, y + 0.18 * s, x - 0.4 * s, y);
    ctx.quadraticCurveTo(x - 0.18 * s, y - 0.18 * s, x, y - 0.5 * s);
  } else if (suit === '♥') {
    ctx.moveTo(x, y + 0.45 * s);
    ctx.bezierCurveTo(x - 0.15 * s, y + 0.3 * s, x - 0.5 * s, y + 0.05 * s, x - 0.5 * s, y - 0.18 * s);
    ctx.bezierCurveTo(x - 0.5 * s, y - 0.44 * s, x - 0.2 * s, y - 0.52 * s, x, y - 0.26 * s);
    ctx.bezierCurveTo(x + 0.2 * s, y - 0.52 * s, x + 0.5 * s, y - 0.44 * s, x + 0.5 * s, y - 0.18 * s);
    ctx.bezierCurveTo(x + 0.5 * s, y + 0.05 * s, x + 0.15 * s, y + 0.3 * s, x, y + 0.45 * s);
  } else if (suit === '♠') {
    const yy = y - 0.08 * s; // cœur renversé, puis la tige
    ctx.moveTo(x, yy - 0.42 * s);
    ctx.bezierCurveTo(x - 0.15 * s, yy - 0.27 * s, x - 0.5 * s, yy - 0.05 * s, x - 0.5 * s, yy + 0.16 * s);
    ctx.bezierCurveTo(x - 0.5 * s, yy + 0.4 * s, x - 0.2 * s, yy + 0.46 * s, x, yy + 0.24 * s);
    ctx.bezierCurveTo(x + 0.2 * s, yy + 0.46 * s, x + 0.5 * s, yy + 0.4 * s, x + 0.5 * s, yy + 0.16 * s);
    ctx.bezierCurveTo(x + 0.5 * s, yy - 0.05 * s, x + 0.15 * s, yy - 0.27 * s, x, yy - 0.42 * s);
    ctx.moveTo(x, y + 0.1 * s);
    ctx.lineTo(x - 0.17 * s, y + 0.5 * s);
    ctx.lineTo(x + 0.17 * s, y + 0.5 * s);
  } else {
    const r = 0.21 * s;
    ctx.arc(x, y - 0.24 * s, r, 0, Math.PI * 2);
    ctx.moveTo(x - 0.22 * s + r, y + 0.08 * s);
    ctx.arc(x - 0.22 * s, y + 0.08 * s, r, 0, Math.PI * 2);
    ctx.moveTo(x + 0.22 * s + r, y + 0.08 * s);
    ctx.arc(x + 0.22 * s, y + 0.08 * s, r, 0, Math.PI * 2);
    ctx.moveTo(x, y);
    ctx.lineTo(x - 0.16 * s, y + 0.5 * s);
    ctx.lineTo(x + 0.16 * s, y + 0.5 * s);
  }
  ctx.fill();
}

function drawCard(ctx, card, x, y, hidden = false) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;
  roundRect(ctx, x, y, CARD_W, CARD_H, 10);
  ctx.fillStyle = hidden ? '#b3261e' : '#ffffff';
  ctx.fill();
  ctx.restore();

  if (hidden) {
    // Dos de carte : cadre blanc et losanges.
    roundRect(ctx, x + 7, y + 7, CARD_W - 14, CARD_H - 14, 6);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    for (let d = -CARD_H; d < CARD_W + CARD_H; d += 14) {
      ctx.beginPath();
      ctx.moveTo(x + d, y);
      ctx.lineTo(x + d - CARD_H, y + CARD_H);
      ctx.moveTo(x + d - CARD_H, y);
      ctx.lineTo(x + d, y + CARD_H);
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = '#ffffff';
    ctx.font = font(34, { bold: true, serif: true });
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('K', x + CARD_W / 2, y + CARD_H / 2 + 2);
    return;
  }

  const color = RED.has(card.suit) ? '#d0021b' : '#111111';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = font(card.rank === '10' ? 24 : 27, { bold: true });
  ctx.fillText(card.rank, x + 18, y + 31);
  drawSuit(ctx, card.suit, x + 18, y + 47, 17);
  // Coin opposé, à l'envers.
  ctx.save();
  ctx.translate(x + CARD_W - 18, y + CARD_H - 31);
  ctx.rotate(Math.PI);
  ctx.fillText(card.rank, 0, 0);
  drawSuit(ctx, card.suit, 0, 16, 17);
  ctx.restore();

  if (['V', 'D', 'R'].includes(card.rank)) {
    // Figure : cadre doré, lettre et couleur au centre.
    roundRect(ctx, x + 30, y + 22, CARD_W - 60, CARD_H - 44, 6);
    ctx.fillStyle = '#f6e7b0';
    ctx.fill();
    ctx.strokeStyle = '#c9a227';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = font(36, { bold: true, serif: true });
    ctx.fillText(card.rank, x + CARD_W / 2, y + CARD_H / 2 + 2);
    drawSuit(ctx, card.suit, x + CARD_W / 2, y + CARD_H / 2 + 26, 22);
  } else {
    drawSuit(ctx, card.suit, x + CARD_W / 2, y + CARD_H / 2 + 4, card.rank === 'A' ? 62 : 48);
  }
}

function pill(ctx, text, cx, y, bg, size = 18) {
  ctx.font = font(size, { bold: true });
  const w = ctx.measureText(text).width + 22;
  roundRect(ctx, cx - w / 2, y, w, size + 12, (size + 12) / 2);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, y + (size + 12) / 2 + 1);
}

function table(width, height, watermark) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  roundRect(ctx, 0, 0, width, height, 28);
  const bg = ctx.createRadialGradient(width / 2, height / 2, 40, width / 2, height / 2, width * 0.7);
  bg.addColorStop(0, '#1f7a3f');
  bg.addColorStop(1, '#0b3d1e');
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.strokeStyle = '#5c3a1a';
  ctx.lineWidth = 10;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.font = font(86, { bold: true, serif: true });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(watermark, width / 2, height / 2);
  return { canvas, ctx };
}

// Une rangée de cartes centrée sur cx, resserrée si elle dépasse maxW.
function drawRow(ctx, cards, cx, y, maxW, hiddenFrom = Infinity) {
  const gap = cards.length > 1 ? Math.min(CARD_W + 12, (maxW - CARD_W) / (cards.length - 1)) : 0;
  const total = CARD_W + gap * (cards.length - 1);
  cards.forEach((c, i) => drawCard(ctx, c, cx - total / 2 + i * gap, y, i >= hiddenFrom));
}

// Table de blackjack : le joueur à gauche, le croupier à droite.
// hand = { label, cards, hiddenFrom, tag, tagColor }
export async function renderBlackjack(player, dealer) {
  const W = 960;
  const H = 300;
  const { canvas, ctx } = table(W, H, 'BLACKJACK');
  for (const [hand, cx, color] of [
    [player, W * 0.27, '#3b82f6'],
    [dealer, W * 0.73, '#dc2626'],
  ]) {
    pill(ctx, hand.label, cx, 14, color);
    drawRow(ctx, hand.cards, cx, 60, W * 0.42, hand.hiddenFrom);
    pill(ctx, hand.tag, cx, 226, hand.tagColor ?? 'rgba(0,0,0,0.55)', 22);
  }
  return new AttachmentBuilder(await canvas.encode('png'), { name: 'blackjack.png' });
}

// Main de poker : 5 cartes, « GARDÉE » au-dessus de celles qu'on garde.
export async function renderPoker(cards, held, tag) {
  const W = 700;
  const H = 280;
  const { canvas, ctx } = table(W, H, 'POKER');
  const gap = (W - 60 - CARD_W) / 4;
  cards.forEach((c, i) => {
    const x = 30 + i * gap;
    if (held.has(i)) pill(ctx, 'GARDÉE', x + CARD_W / 2, 14, '#16a34a', 15);
    drawCard(ctx, c, x, 52);
  });
  pill(ctx, tag, W / 2, 214, 'rgba(0,0,0,0.55)', 22);
  return new AttachmentBuilder(await canvas.encode('png'), { name: 'poker.png' });
}
