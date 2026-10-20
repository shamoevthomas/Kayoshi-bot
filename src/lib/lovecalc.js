import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
} from 'discord.js';
import { createCanvas } from '@napi-rs/canvas';
import { createHash } from 'node:crypto';
import { font, fetchImage } from './fonts.js';

// Calculateur d'amour / de haine / d'amitié, comme le bot Koya :
//   ^^lc (amour), ^^hc (haine), ^^fc (amitié), suivis de « random », d'un ou de deux membres.
// Le pourcentage a l'air aléatoire mais reste toujours le même pour un duo et un mode.
// Les boutons sous le message (réservés à l'auteur de la commande) gardent leur état dans leur id :
//   lc_<action>:<mode>:<auteur>:<membre 1>:<membre 2>

const COMMAND = /^\^\^([lhf])c(?:\s+(.*))?$/i;
const MODES = {
  love: {
    letter: 'l',
    label: 'Amour',
    emoji: '❤️',
    of: 'd’amour',
    colors: ['#2ee6d6', '#f3f08a'],
    shape: ['#ff4d7d', '#ff9ab8'],
    empty: 'rgba(255,255,255,0.45)',
    outline: 'rgba(170,20,70,0.55)',
    phrases: [
      'Aucune étincelle entre **{a}** et **{b}**… peut-être dans une autre vie',
      'Entre **{a}** et **{b}**, c’est plutôt glacial',
      '**{a}** et **{b}**, c’est compliqué… mais pas impossible',
      'Il se passe clairement quelque chose entre **{a}** et **{b}**',
      'La connexion entre **{a}** et **{b}** est une pure énergie réconfortante',
      '**{a}** et **{b}** sont faits l’un pour l’autre',
    ],
    decor: '💖',
  },
  hate: {
    letter: 'h',
    label: 'Haine',
    emoji: '💔',
    of: 'de haine',
    colors: ['#3a0d12', '#a3243c'],
    shape: ['#5c0a1c', '#d63a55'],
    empty: 'rgba(255,255,255,0.18)',
    outline: 'rgba(60,0,15,0.7)',
    phrases: [
      '**{a}** et **{b}** s’entendent à merveille, aucune haine ici',
      'Quelques petites tensions entre **{a}** et **{b}**',
      'Entre **{a}** et **{b}**, l’ambiance est électrique',
      '**{a}** et **{b}** ont du mal à se supporter',
      '**{a}** et **{b}** ne peuvent pas se voir',
      '**{a}** et **{b}** sont des ennemis jurés',
    ],
    decor: '💢',
  },
  friendship: {
    letter: 'f',
    label: 'Amitié',
    emoji: '⭐',
    of: 'd’amitié',
    colors: ['#4facfe', '#a6f77b'],
    shape: ['#ffb703', '#ffe066'],
    empty: 'rgba(255,255,255,0.45)',
    outline: 'rgba(150,80,0,0.6)',
    phrases: [
      '**{a}** et **{b}** se connaissent à peine',
      '**{a}** et **{b}**, de simples connaissances',
      '**{a}** et **{b}** s’entendent plutôt bien',
      '**{a}** et **{b}** forment une sacrée équipe',
      'L’amitié entre **{a}** et **{b}** est solide comme un roc',
      '**{a}** et **{b}** sont inséparables',
    ],
    decor: '🤝',
  },
};
const MODE_BY_LETTER = Object.fromEntries(Object.entries(MODES).map(([mode, m]) => [m.letter, mode]));

// --- Image ---

// Cœur classique (courbe x = 16 sin³t, y = 13 cos t − 5 cos 2t − 2 cos 3t − cos 4t) : lobes
// ronds et larges, pointe courte. Points du contour, centré sur (cx, cy), largeur « width ».
function heartPoints(cx, cy, width) {
  const k = width / 32;
  return Array.from({ length: 240 }, (_, i) => {
    const t = (i / 240) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    // La courbe va de y = −17 (pointe) à y ≈ 12 (lobes) : +2,5 la centre verticalement.
    return [cx + x * k, cy - (y + 2.5) * k];
  });
}

function starPoints(cx, cy, size) {
  const outer = size / 2;
  const inner = outer * 0.48;
  return Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 ? inner : outer;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
}

function shapePath(ctx, points) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

// Hauteur de la ligne sous laquelle se trouve « fraction » de la SURFACE de la forme : la pointe
// du cœur est étroite, un remplissage à la hauteur y paraîtrait presque vide à 25 %.
function fillLevel(points, fraction) {
  const ys = points.map(([, y]) => y);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  if (fraction <= 0) return bottom;
  if (fraction >= 1) return top;
  const steps = 300;
  const dy = (bottom - top) / steps;
  // Largeur de la forme à chaque hauteur, du bas vers le haut (règle pair-impair sur les bords).
  const widths = [];
  for (let i = 0; i < steps; i++) {
    const y = bottom - (i + 0.5) * dy;
    const xs = [];
    points.forEach(([x1, y1], j) => {
      const [x2, y2] = points[(j + 1) % points.length];
      if (y1 > y !== y2 > y) xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
    });
    xs.sort((a, b) => a - b);
    let width = 0;
    for (let k = 0; k + 1 < xs.length; k += 2) width += xs[k + 1] - xs[k];
    widths.push(width);
  }
  const total = widths.reduce((a, b) => a + b, 0);
  let area = 0;
  for (let i = 0; i < steps; i++) {
    area += widths[i];
    if (area >= fraction * total) return bottom - (i + 1) * dy;
  }
  return top;
}

// Forme remplie jusqu'au pourcentage comme un liquide, le reste vide et translucide, avec
// ombre douce, contour, reflet brillant (shine) et fissure du cœur brisé (crack).
function drawGauge(ctx, points, percent, { shape: [dark, light], empty }, { shine = null, crack = null } = {}) {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];

  // Ombre + partie vide.
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 6;
  shapePath(ctx, points);
  ctx.fillStyle = empty;
  ctx.fill();
  ctx.restore();

  ctx.save();
  shapePath(ctx, points);
  ctx.clip();
  // Partie remplie, et surface du liquide.
  const level = fillLevel(points, percent / 100);
  const fill = ctx.createLinearGradient(0, top, 0, bottom);
  fill.addColorStop(0, light);
  fill.addColorStop(1, dark);
  ctx.fillStyle = fill;
  ctx.fillRect(left, level, right - left, bottom - level + 2);
  if (percent > 0 && percent < 100) {
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(left, level, right - left, 3);
  }
  if (shine) {
    const glow = ctx.createRadialGradient(shine.x, shine.y, 0, shine.x, shine.y, shine.r);
    glow.addColorStop(0, 'rgba(255,255,255,0.45)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(left, top, right - left, bottom - top);
  }
  ctx.restore();

  shapePath(ctx, points);
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.stroke();

  if (crack) {
    ctx.beginPath();
    crack.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.strokeStyle = 'rgba(30,0,8,0.55)';
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }
}

function avatar(ctx, img, cx, cy, size, fallback) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2 + 10, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.clip();
  if (img) ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
  else {
    ctx.fillStyle = '#4e5058';
    ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
    ctx.font = font(size * 0.42, { bold: true });
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText([...fallback][0]?.toUpperCase() ?? '?', cx, cy);
  }
  ctx.restore();
}

async function renderCard(mode, userA, userB, percent) {
  const m = MODES[mode];
  const W = 1000;
  const H = 340;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const [imgA, imgB] = await Promise.all([
    fetchImage(userA.displayAvatarURL({ extension: 'png', size: 256 })),
    fetchImage(userB.displayAvatarURL({ extension: 'png', size: 256 })),
  ]);

  // Fond dégradé + panneau translucide.
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, m.colors[0]);
  bg.addColorStop(1, m.colors[1]);
  ctx.beginPath();
  ctx.roundRect(0, 0, W, H, 26);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(36, 30, W - 72, H - 60, 28);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 2;
  ctx.stroke();

  avatar(ctx, imgA, 210, H / 2, 210, userA.username);
  avatar(ctx, imgB, W - 210, H / 2, 210, userB.username);

  // Cœur (amour), cœur brisé (haine) ou étoile (amitié), rempli jusqu'au pourcentage.
  const cx = W / 2;
  const cy = H / 2 + 6;
  const isStar = mode === 'friendship';
  if (isStar) {
    drawGauge(ctx, starPoints(cx, cy + 10, 280), percent, m);
  } else {
    const hy = cy - 4;
    const k = 236 / 32; // pixels par unité de la courbe du cœur
    const at = ([x, y]) => [cx + x * k, hy + y * k];
    drawGauge(ctx, heartPoints(cx, hy, 236), percent, m, {
      shine: { x: cx - 8 * k, y: hy - 9 * k, r: 7.5 * k },
      // Du creux du cœur jusqu'à la pointe.
      crack: mode === 'hate' ? [[0, -7.5], [-2.2, -3], [1.6, 1.5], [-1.8, 6.5], [0.8, 11], [0, 13.2]].map(at) : null,
    });
  }

  // Pourcentage, avec un contour pour rester lisible sur la partie vide comme sur la partie remplie.
  const ty = isStar ? cy + 24 : cy - 4;
  ctx.save();
  ctx.font = font(isStar ? 48 : 66, { bold: true });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = m.outline;
  ctx.lineWidth = 7;
  ctx.lineJoin = 'round';
  ctx.strokeText(`${percent}%`, cx, ty);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`${percent}%`, cx, ty);
  ctx.restore();

  return canvas.encode('png');
}

// --- Message ---

const nameOf = (guild, user) => guild.members.cache.get(user.id)?.displayName ?? user.globalName ?? user.username;
const clean = (name) => name.replace(/[*_~`|\\]/g, '');

function buttons(mode, authorId, a, b) {
  const state = `${mode}:${authorId}:${a}:${b}`;
  const others = Object.entries(MODES).filter(([key]) => key !== mode);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`lc_rand:${state}`).setLabel('Aléatoire').setStyle(ButtonStyle.Secondary).setEmoji('🎲'),
    new ButtonBuilder().setCustomId(`lc_user:${state}`).setLabel('Changer de membre').setStyle(ButtonStyle.Secondary).setEmoji('👥'),
    ...others.map(([key, m]) =>
      new ButtonBuilder().setCustomId(`lc_mode:${key}:${authorId}:${a}:${b}`).setLabel(m.label).setStyle(ButtonStyle.Secondary).setEmoji(m.emoji),
    ),
  );
}

// Pourcentage fixe d'un duo pour un mode (0 à 100), le même dans les deux sens (A + B = B + A).
function pairPercent(mode, idA, idB) {
  const [first, second] = [idA, idB].sort();
  return createHash('sha256').update(`${mode}:${first}:${second}`).digest().readUInt32BE(0) % 101;
}

async function resultPayload(guild, mode, authorId, userA, userB) {
  const m = MODES[mode];
  const percent = pairPercent(mode, userA.id, userB.id);
  const phrase = m.phrases[Math.min(m.phrases.length - 1, Math.floor(percent / (101 / m.phrases.length)))]
    .replace('{a}', clean(nameOf(guild, userA)))
    .replace('{b}', clean(nameOf(guild, userB)));
  const png = await renderCard(mode, userA, userB, percent);
  return {
    content: `${userA} + ${userB} = **${percent}%** ${m.of} ${m.emoji}\n${m.decor} ${phrase} ${m.decor}`,
    files: [new AttachmentBuilder(png, { name: 'lovecalc.png' })],
    attachments: [],
    components: [buttons(mode, authorId, userA.id, userB.id)],
    allowedMentions: { parse: [] },
  };
}

// Membre au hasard du serveur (humain, différent de ceux à exclure).
async function randomMember(guild, excludeIds) {
  const pick = () => guild.members.cache.filter((mem) => !mem.user.bot && !excludeIds.includes(mem.id));
  let pool = pick();
  if (pool.size < 5) {
    await guild.members.fetch().catch(() => null);
    pool = pick();
  }
  return pool.random()?.user ?? null;
}

async function resolveUser(client, token) {
  const id = token.match(/^<@!?(\d{17,20})>$/)?.[1] ?? token.match(/^\d{17,20}$/)?.[0];
  return id ? client.users.fetch(id).catch(() => null) : null;
}

// --- Commandes en message ---

export async function handleLoveCommand(message) {
  if (!message.guild || message.author.bot) return false;
  const match = message.content.trim().match(COMMAND);
  if (!match) return false;
  const mode = MODE_BY_LETTER[match[1].toLowerCase()];
  const args = (match[2] ?? '').trim().split(/\s+/).filter(Boolean);

  // ^^lc / ^^lc random → toi + quelqu'un au hasard ; ^^lc @a → toi + a ; ^^lc @a @b → a + b.
  let userA = message.author;
  let userB = null;
  const named = [];
  for (const token of args.filter((t) => t.toLowerCase() !== 'random').slice(0, 2)) {
    const user = await resolveUser(message.client, token);
    if (!user) {
      await message
        .reply({ content: `❌ Membre introuvable : \`${token}\`. Mentionne-le (\`^^${match[1]}c @membre\`) ou donne son ID.`, allowedMentions: { repliedUser: false } })
        .catch(() => {});
      return true;
    }
    named.push(user);
  }
  if (named.length === 2) [userA, userB] = named;
  else if (named.length === 1) userB = named[0];
  else userB = await randomMember(message.guild, [message.author.id]);
  if (!userB) {
    await message.reply({ content: '❌ Je n’ai trouvé personne d’autre sur le serveur.', allowedMentions: { repliedUser: false } }).catch(() => {});
    return true;
  }

  await message.channel.sendTyping().catch(() => {});
  const payload = await resultPayload(message.guild, mode, message.author.id, userA, userB);
  delete payload.attachments;
  await message.reply({ ...payload, allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
  return true;
}

// --- Boutons et menu (préfixe « lc_ ») ---

export async function handleLoveInteraction(interaction) {
  const [action, mode, authorId, a, b] = interaction.customId.split(':');
  if (!MODES[mode]) return;
  if (interaction.user.id !== authorId) {
    return interaction.reply({ content: '❌ Ces boutons sont réservés à la personne qui a lancé la commande. Lance la tienne avec `^^lc` !', ephemeral: true });
  }
  const { guild, client } = interaction;
  const fetchUser = (id) => client.users.fetch(id).catch(() => null);

  // Changer de membre : menu de sélection à la place des boutons (1 membre = remplace le 2ᵉ, 2 = les deux).
  if (interaction.isButton() && action === 'lc_user') {
    return interaction.update({
      components: [
        new ActionRowBuilder().addComponents(
          new UserSelectMenuBuilder()
            .setCustomId(`lc_pick:${mode}:${authorId}:${a}:${b}`)
            .setPlaceholder('Choisis 1 membre (à la place du 2ᵉ) ou 2 membres')
            .setMinValues(1)
            .setMaxValues(2),
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`lc_back:${mode}:${authorId}:${a}:${b}`).setLabel('Annuler').setStyle(ButtonStyle.Secondary),
        ),
      ],
    });
  }

  if (interaction.isButton() && action === 'lc_back') {
    return interaction.update({ components: [buttons(mode, authorId, a, b)] });
  }

  let pair;
  if (interaction.isUserSelectMenu() && action === 'lc_pick') {
    const picked = [...interaction.users.values()];
    pair = picked.length === 2 ? picked : [await fetchUser(a), picked[0]];
  } else if (interaction.isButton() && action === 'lc_rand') {
    // Aléatoire : garde le 1ᵉʳ membre, tire un nouveau 2ᵉ au hasard.
    pair = [await fetchUser(a), await randomMember(guild, [a, b])];
  } else if (interaction.isButton() && action === 'lc_mode') {
    pair = [await fetchUser(a), await fetchUser(b)];
  } else return;

  if (!pair[0] || !pair[1]) return interaction.reply({ content: '❌ Membre introuvable.', ephemeral: true });
  await interaction.deferUpdate();
  const payload = await resultPayload(guild, mode, authorId, pair[0], pair[1]);
  await interaction.editReply(payload).catch(() => {});
}
